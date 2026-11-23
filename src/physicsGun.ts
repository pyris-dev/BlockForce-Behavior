import {
  Entity,
  EntityHitEntityAfterEvent,
  ItemUseAfterEvent,
  Player,
  system,
  world,
  Vector3
} from "@minecraft/server";
import {
  addRotation,
  directionFromRotation,
  getForwardLocation
} from "./utils";
import { BlockHolder } from "./blockHolder";
import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
import { Vector3Utils } from "@minecraft/math";

/**
 * A map to hold entities that are being held by players.
 * Key: Player ID
 * Value: Entity being held
 */
export const heldEntities = new Map<string, Entity>();

/**
 * Interface for cached projectile data
 */
interface CachedProjectile {
  entity: Entity;
  velocity: Vector3;
  direction: Vector3;
  gravity: number;
  lastPosition: Vector3;
  intervalId: number;
}

/**
 * A map to cache projectile motion data when chunks are unloaded
 * Key: Entity ID
 * Value: Projectile data
 */
const cachedProjectiles = new Map<string, CachedProjectile>();

// Entity IDs created or used by this script session must not be recovered.
const activeFakeBlocks = new Set<string>();

/**
 * Places a leftover fake block in the nearest loaded air block within three blocks.
 * Leaves the entity intact if its type or a safe position cannot be found.
 */
function recoverFakeBlock(entity: Entity): void {
  if (!entity.isValid || entity.typeId !== "blockforce:fake_block") return;
  if (activeFakeBlocks.has(entity.id)) return;

  try {
    const typeId = BlockHolder.getStoredTypeId(entity);
    if (!typeId) {
      console.warn(
        `Cannot recover fake block ${entity.id}: block type is missing`
      );
      return;
    }

    const { dimension, location } = entity;
    const origin = {
      x: Math.floor(location.x),
      y: Math.floor(location.y),
      z: Math.floor(location.z)
    };

    for (let distance = 0; distance <= 3; distance++) {
      for (let x = -distance; x <= distance; x++) {
        for (let y = -distance; y <= distance; y++) {
          for (let z = -distance; z <= distance; z++) {
            if (Math.abs(x) + Math.abs(y) + Math.abs(z) !== distance) continue;

            const position = {
              x: origin.x + x,
              y: origin.y + y,
              z: origin.z + z
            };
            if (
              position.y < dimension.heightRange.min ||
              position.y >= dimension.heightRange.max
            )
              continue;
            if (!dimension.isChunkLoaded(position)) continue;

            const block = dimension.getBlock(position);
            if (!block?.isValid) continue;
            if (!block.isAir) continue;

            dimension.setBlockType(position, typeId);
            entity.remove();
            return;
          }
        }
      }
    }

    console.warn(
      `Cannot recover fake block ${entity.id}: no nearby loaded air block`
    );
  } catch (error) {
    console.warn(`Failed to recover fake block ${entity.id}: ${error}`);
  }
}

export class PhysicsGun {
  /**
   * Handles when a player uses the physics gun item.
   * If the player is already holding something, releases it.
   * Otherwise, checks for an entity or block to pick up.
   * @param data The item use event data.
   */
  static handleInteraction(data: ItemUseAfterEvent) {
    const { source: player } = data;
    if (!player.isValid) return;

    if (heldEntities.has(player.id)) {
      const entity = heldEntities.get(player.id);
      if (entity?.isValid) PhysicsGun.handleReleaseEntity(entity, player.id);

      return;
    }

    if (PhysicsGun.checkForEntity(player)) return;
    if (PhysicsGun.checkForBlock(player)) return;
  }

  /**
   * Called when the physics gun "hits" an entity.
   * This launches the entity forward with gravity applied.
   * @param data The entity hit event data.
   */
  static handleHit(data: EntityHitEntityAfterEvent) {
    const { hitEntity, damagingEntity } = data;
    if (
      !(damagingEntity instanceof Player) ||
      !damagingEntity.isValid ||
      !hitEntity.isValid
    )
      return;

    // Different power based on entity type
    const isFakeBlock = hitEntity.typeId === "blockforce:fake_block";
    if (isFakeBlock) activeFakeBlocks.add(hitEntity.id);
    const power = isFakeBlock ? 1.2 : 0.8; // Entities shoot 50% faster than blocks
    const gravity = -0.03; // Gravity applied each tick
    const direction = directionFromRotation(damagingEntity.getRotation());
    const velocity = Vector3Utils.scale(direction, power);

    heldEntities.delete(damagingEntity.id); // Remove from held list (if any)

    // Start simulating the projectile motion
    PhysicsGun.startProjectileMotion(hitEntity, velocity, direction, gravity);
  }

  /**
   * Checks if the player is looking at an entity.
   * If so, grabs it and adds it to heldEntities.
   * @param player The player to check.
   * @returns True if the player grabbed an entity.
   */
  static checkForEntity(player: Player): boolean {
    if (!player.isValid) return false;

    const targetEntity = player.getEntitiesFromViewDirection({
      maxDistance: 8 // Max distance to detect
    });
    if (targetEntity.length === 0) return false;

    const { entity: hitEntity } = targetEntity[0];
    if (!hitEntity.isValid) return false;

    if (hitEntity.typeId === "blockforce:fake_block")
      activeFakeBlocks.add(hitEntity.id);

    // Store the held entity in the map
    heldEntities.set(player.id, hitEntity);
    return true;
  }

  /**
   * Checks if the player is looking at a block.
   * If so, it replaces the block with a fake block entity and stores it.
   * @param player The player to check.
   * @returns True if the player grabbed a block.
   */
  static checkForBlock(player: Player): boolean {
    if (!player.isValid) return false;

    const targetBlock = player.getBlockFromViewDirection({
      maxDistance: 8
    });
    if (!targetBlock) return false;

    const { block: hitBlock } = targetBlock;
    if (!hitBlock.isValid) return false;

    // Calculate where to place the fake block (4 blocks in front of player, 1 block above ground)
    const targetPosition = getForwardLocation(
      player.location,
      player.getRotation(),
      4
    );
    targetPosition.y += 1;

    if (!player.isValid) {
      return false;
    }
    if (!hitBlock.dimension.isChunkLoaded(hitBlock.location)) return false;

    // Create a fake block holder entity and set the block to air
    const blockHolder = BlockHolder.create(
      player,
      hitBlock.typeId,
      targetPosition
    );

    activeFakeBlocks.add(blockHolder.entity.id);
    hitBlock.dimension.setBlockType(hitBlock.location, MinecraftBlockTypes.Air);

    // Store the holder entity in the map
    heldEntities.set(player.id, blockHolder.entity);
    return true;
  }

  /**
   * Handles releasing a held entity back into the world.
   * For fake blocks, this places the block in the world and removes the entity.
   * @param targetEntity The entity to release.
   * @param holderId The ID of the player who was holding it.
   */
  static handleReleaseEntity(targetEntity: Entity, holderId: string) {
    heldEntities.delete(holderId); // Remove from map
    if (!targetEntity.isValid) return;

    // Clear any cached projectile data for this entity
    const cached = cachedProjectiles.get(targetEntity.id);
    if (cached?.intervalId) system.clearRun(cached.intervalId);

    cachedProjectiles.delete(targetEntity.id);

    // If it's not a fake block, just return
    if (targetEntity.typeId !== "blockforce:fake_block") return;

    // Get the type ID the fake block represents and place it back in the world
    const typeId =
      BlockHolder.getByEntity(targetEntity)?.getTypeId() ??
      BlockHolder.getStoredTypeId(targetEntity);
    if (!typeId) {
      console.warn(
        `Cannot release fake block ${targetEntity.id}: block type is missing`
      );
      return;
    }

    const location = targetEntity.location;
    const currentPos = {
      x: Math.floor(location.x),
      y: Math.floor(location.y),
      z: Math.floor(location.z)
    };
    if (!targetEntity.dimension.isChunkLoaded(currentPos)) {
      console.warn(
        `Cannot release fake block ${targetEntity.id}: chunk is not loaded`
      );
      return;
    }
    targetEntity.dimension.setBlockType(currentPos, typeId);

    // Finally, remove the fake block entity
    targetEntity.remove();
    activeFakeBlocks.delete(targetEntity.id);
  }

  /**
   * Starts projectile motion for an entity with caching support
   * @param entity The entity to apply motion to
   * @param velocity Initial velocity vector
   * @param direction Facing direction vector
   * @param gravity Gravity value to apply each tick
   */
  static startProjectileMotion(
    entity: Entity,
    velocity: Vector3,
    direction: Vector3,
    gravity: number
  ) {
    if (!entity.isValid) return;

    const intervalId = system.runInterval(() => {
      if (!entity.isValid) return system.clearRun(intervalId);

      PhysicsGun.updateProjectileMotion(
        entity,
        velocity,
        direction,
        gravity,
        intervalId
      );
    }, 1);

    if (!entity.isValid) return system.clearRun(intervalId);

    cachedProjectiles.set(entity.id, {
      entity,
      velocity: { ...velocity },
      direction: { ...direction },
      gravity,
      lastPosition: { ...entity.location },
      intervalId
    });
  }

  /**
   * Updates projectile motion for a single tick
   * @param entity The entity to update
   * @param velocity Current velocity vector (will be modified)
   * @param direction Facing direction vector
   * @param gravity Gravity value
   * @param intervalId The interval ID to clear if motion should stop
   */
  static updateProjectileMotion(
    entity: Entity,
    velocity: Vector3,
    direction: Vector3,
    gravity: number,
    intervalId: number
  ) {
    if (!entity.isValid) {
      system.clearRun(intervalId);
      cachedProjectiles.delete(entity.id);
      return;
    }

    const currentDim = entity.dimension;
    const currentPos = entity.location;
    const nextPos = Vector3Utils.add(currentPos, velocity);

    // Check world bounds first
    if (nextPos.y < 10 || nextPos.y > 250) {
      system.clearRun(intervalId);
      cachedProjectiles.delete(entity.id);
      PhysicsGun.handleReleaseEntity(entity, "");
      return;
    }

    // Check if chunk is loaded
    if (!currentDim.isChunkLoaded(nextPos)) {
      // Cache the projectile and pause the interval
      const cached = cachedProjectiles.get(entity.id);
      if (cached) {
        cached.velocity = { ...velocity };
        cached.lastPosition = { ...currentPos };
        system.clearRun(intervalId);
      }
      return;
    }

    // Use continuous collision detection with small incremental steps
    const maxSteps = 20; // Maximum steps to prevent infinite loops
    let currentStep = 0;
    const stepSize = 0.1;
    let testPos = { ...currentPos };
    let collisionDetected = false;

    // Move in small increments until collision or velocity distance is covered
    while (currentStep < maxSteps && !collisionDetected) {
      // Calculate next micro-step
      const stepVelocity = {
        x: velocity.x * stepSize,
        y: velocity.y * stepSize,
        z: velocity.z * stepSize
      };

      testPos = {
        x: testPos.x + stepVelocity.x,
        y: testPos.y + stepVelocity.y,
        z: testPos.z + stepVelocity.z
      };

      // Check if we've moved the full velocity distance
      const totalDistance = Vector3Utils.distance(currentPos, testPos);
      const targetDistance = Vector3Utils.distance(currentPos, nextPos);

      if (totalDistance >= targetDistance) testPos = { ...nextPos }; // Don't overshoot

      // Check for collision at this micro-step
      if (!currentDim.isChunkLoaded(testPos)) {
        system.clearRun(intervalId);
        cachedProjectiles.delete(entity.id);
        return;
      }

      const block = currentDim.getBlock(testPos);
      if (block?.isValid && !block.isAir) {
        collisionDetected = true;
        // Stop at the last safe position
        break;
      }

      // Move entity to this safe position if no collision
      if (!collisionDetected)
        entity.teleport(testPos, {
          facingLocation: Vector3Utils.add(testPos, direction)
        });

      currentStep++;

      // If we've reached the target distance, break
      if (totalDistance >= targetDistance) break;
    }

    if (collisionDetected) {
      // Stop motion and release entity when colliding
      system.clearRun(intervalId);
      cachedProjectiles.delete(entity.id);
      PhysicsGun.handleReleaseEntity(entity, "");
      return;
    }

    // Only move if no collision was detected and we haven't moved incrementally
    // (the incremental movement already handled positioning above)

    // Apply gravity and update cached velocity
    velocity.y += gravity;
    const cached = cachedProjectiles.get(entity.id);
    if (cached) {
      cached.velocity = { ...velocity };
      cached.lastPosition = { ...entity.location }; // Use actual current position
    }
  }

  /**
   * Resumes cached projectiles when their chunks are loaded
   */
  static resumeCachedProjectiles() {
    for (const [entityId, cached] of cachedProjectiles) {
      if (!cached.entity?.isValid) {
        cachedProjectiles.delete(entityId);
        continue;
      }

      // Check if the chunk is now loaded
      if (cached.entity.dimension.isChunkLoaded(cached.lastPosition)) {
        // Resume the projectile motion
        const intervalId = system.runInterval(() => {
          PhysicsGun.updateProjectileMotion(
            cached.entity,
            cached.velocity,
            cached.direction,
            cached.gravity,
            intervalId
          );
        }, 1);

        // Update the interval ID in cache
        cached.intervalId = intervalId;
      }
    }
  }

  /**
   * Cleans up invalid cached projectiles
   */
  static cleanupCachedProjectiles() {
    for (const [entityId, cached] of cachedProjectiles)
      if (!cached.entity?.isValid) {
        if (cached.intervalId) system.clearRun(cached.intervalId);
        cachedProjectiles.delete(entityId);
      }
  }
}

// ===== Global Runtime Logic =====

// Periodically update the position of held entities to follow players
system.runInterval(() => {
  for (const [playerId, entity] of heldEntities) {
    // Remove from map if invalid
    if (!entity || !entity.isValid) {
      heldEntities.delete(playerId);
      continue;
    }

    const player = world.getEntity(playerId);
    if (!(player instanceof Player) || !player.isValid) continue;

    // Position the held entity 4 blocks in front and 1 above the player
    const targetPosition = getForwardLocation(
      player.location,
      player.getRotation(),
      4
    );
    targetPosition.y += 1;

    // Move the entity to the updated position
    entity.teleport(targetPosition);
  }
}, 1); // Every tick (20 times per second for smooth holding)

// Periodically check for cached projectiles that can be resumed
system.runInterval(() => PhysicsGun.resumeCachedProjectiles(), 5); // Every 5 ticks (4 times per second)

// Periodically clean up invalid cached projectiles
system.runInterval(() => PhysicsGun.cleanupCachedProjectiles(), 100); // Every 5 seconds

function recoverLoadedFakeBlocks(): void {
  for (const dimensionId of ["overworld", "nether", "the_end"]) {
    try {
      world
        .getDimension(dimensionId)
        .getEntities({ type: "blockforce:fake_block" })
        .forEach(recoverFakeBlock);
    } catch (error) {
      console.warn(`Failed to scan ${dimensionId} for fake blocks: ${error}`);
    }
  }
}

// Script reloads may not fire worldLoad for already loaded entities.
system.run(recoverLoadedFakeBlocks);
world.afterEvents.worldLoad.subscribe(recoverLoadedFakeBlocks);

// Chunks loaded after startup can contain leftovers too.
world.afterEvents.entityLoad.subscribe(({ entity }) => {
  if (entity.isValid) recoverFakeBlock(entity);
});

// Cleanup routine: release held entity if player leaves
world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  const entity = heldEntities.get(playerId);
  if (entity?.isValid) PhysicsGun.handleReleaseEntity(entity, playerId);
});

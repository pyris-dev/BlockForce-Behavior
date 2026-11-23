import { EntityInventoryComponent, Player, world } from "@minecraft/server";
import { heldEntities, PhysicsGun } from "./physicsGun";

// Handle use of the physics gun.
world.afterEvents.itemUse.subscribe(({ itemStack, source }) => {
  if (!source.isValid || itemStack.typeId !== "blockforce:physics_gun") return;

  PhysicsGun.handleInteraction({
    itemStack,
    source
  });
});

// Launch an entity when the physics gun hits it.
world.afterEvents.entityHitEntity.subscribe(({ hitEntity, damagingEntity }) => {
  if (
    !(damagingEntity instanceof Player) ||
    !damagingEntity.isValid ||
    !hitEntity.isValid
  )
    return;

  const slotIndex = damagingEntity.selectedSlotIndex;
  const inventory = damagingEntity.getComponent(
    EntityInventoryComponent.componentId
  )?.container;
  if (!inventory?.isValid) return;

  const itemStack = inventory?.getItem(slotIndex);
  if (itemStack?.typeId !== "blockforce:physics_gun") return;

  PhysicsGun.handleHit({
    damagingEntity,
    hitEntity
  });
});

// Release held entities when a player switches away from the physics gun.
world.afterEvents.playerHotbarSelectedSlotChange.subscribe((data) => {
  const player = data.player;
  const oldIndex = data.previousSlotSelected;
  if (!player.isValid) return;

  const inventory = player.getComponent(
    EntityInventoryComponent.componentId
  )?.container;
  if (!inventory?.isValid) return;

  const oldItem = inventory?.getItem(oldIndex);
  if (oldItem?.typeId !== "blockforce:physics_gun") return;

  const entity = heldEntities.get(player.id);
  if (entity?.isValid) PhysicsGun.handleReleaseEntity(entity, player.id);
});

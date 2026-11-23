import {
  Entity,
  EntityEquippableComponent,
  EquipmentSlot,
  Player,
  Vector3
} from "@minecraft/server";

const BLOCK_TYPE_PROPERTY = "blockforce:block_type";

/**
 * Cache of all BlockHolder instances.
 * Key: Entity ID
 * Value: BlockHolder instance
 */
const cachedHolders = new Map<string, BlockHolder>();

/**
 * BlockHolder manages a "fake block" entity, which is used to visually represent a block
 * (e.g. by holding it in the entity's hand) without actually placing a real block in the world.
 */
export class BlockHolder {
  /** The fake block entity being held. */
  public entity: Entity;

  /** The item or block type ID currently displayed by the entity. */
  private typeId: string;

  /**
   * Constructor for BlockHolder. Sets up the entity to visually hold the item/block.
   * @param entity The entity representing the fake block holder
   * @param typeId The type of block/item to display
   * @throws Error if entity is invalid or typeId is empty
   */
  constructor(entity: Entity, typeId: string) {
    if (!entity.isValid)
      throw new Error("Cannot create BlockHolder: entity is invalid");

    if (!typeId.trim())
      throw new Error("Cannot create BlockHolder: typeId is required");

    this.entity = entity;
    this.typeId = typeId;
    entity.setDynamicProperty(BLOCK_TYPE_PROPERTY, typeId);

    // Set the entity's mainhand slot to display the item
    try {
      // This is safe because we already checked entity validity above
      // eslint-disable-next-line minecraft-isvalid/require-is-valid-check
      this.entity.runCommand(
        `replaceitem entity @s slot.weapon.mainhand 0 ${typeId}`
      );
    } catch (error) {
      console.warn(`Failed to set item for BlockHolder: ${error}`);
    }
  }

  /**
   * Returns the typeId of the held item/block.
   * @returns The type ID of the held block/item, or empty string if invalid
   */
  public getTypeId(): string {
    return this.typeId || "";
  }

  /**
   * Updates the typeId and refreshes the visual representation on the entity.
   * @param typeId New type ID to display
   * @returns True if update was successful, false otherwise
   */
  public setTypeId(typeId: string): boolean {
    if (!typeId?.trim()) {
      console.warn("BlockHolder.setTypeId: typeId cannot be empty");
      return false;
    }

    if (!this.entity.isValid) {
      console.warn("BlockHolder.setTypeId: entity is no longer valid");
      return false;
    }

    // Replace the entity's held item with the new block/item
    try {
      this.entity.runCommand(
        `replaceitem entity @s slot.weapon.mainhand 0 ${typeId}`
      );
      this.entity.setDynamicProperty(BLOCK_TYPE_PROPERTY, typeId);
      this.typeId = typeId;
      return true;
    } catch (error) {
      console.warn(`Failed to update item for BlockHolder: ${error}`);
      return false;
    }
  }

  /**
   * Retrieves the BlockHolder instance associated with the given entity.
   * @param entity The entity to find a BlockHolder for
   * @returns The BlockHolder instance, or undefined
   */
  static getByEntity(entity: Entity): BlockHolder | undefined {
    if (!entity.isValid) return undefined;
    return cachedHolders.get(entity.id);
  }

  /**
   * Reads the persisted block type, or the displayed item on older holders.
   */
  static getStoredTypeId(entity: Entity): string | undefined {
    if (!entity.isValid) return undefined;

    const storedType = entity.getDynamicProperty(BLOCK_TYPE_PROPERTY);
    if (typeof storedType === "string" && storedType.trim()) return storedType;

    const equipment = entity.getComponent(
      EntityEquippableComponent.componentId
    );
    if (!equipment?.isValid) return undefined;
    return equipment.getEquipment(EquipmentSlot.Mainhand)?.typeId;
  }

  /**
   * Checks if this BlockHolder instance is still valid.
   * @returns True if the entity is still valid and cached
   */
  public isValid(): boolean {
    return this.entity?.isValid === true && cachedHolders.has(this.entity.id);
  }

  /**
   * Destroys this BlockHolder instance, removing it from cache and optionally removing the entity.
   * @param removeEntity Whether to remove the entity from the world (default: true)
   */
  public destroy(removeEntity: boolean = true): void {
    // Remove from cache
    cachedHolders.delete(this.entity.id);

    // Optionally remove the entity
    if (removeEntity && this.entity.isValid) {
      try {
        this.entity.remove();
      } catch (error) {
        console.warn(
          `Failed to remove entity in BlockHolder.destroy: ${error}`
        );
      }
    }
  }

  /**
   * Cleans up invalid entries from the cache.
   * Should be called periodically to prevent memory leaks.
   */
  static cleanupCache(): void {
    for (const [entityId, holder] of cachedHolders)
      if (!holder.entity.isValid) cachedHolders.delete(entityId);
  }

  /**
   * Gets the current size of the cache.
   * @returns The number of cached BlockHolder instances
   */
  static getCacheSize(): number {
    return cachedHolders.size;
  }

  /**
   * Creates a new fake block entity and returns its BlockHolder wrapper.
   * @param player The player who owns or spawns the fake block
   * @param typeId The type of block/item the fake block should display
   * @param location Optional location to spawn the fake block at (defaults to player location)
   * @returns A new BlockHolder instance
   * @throws Error if creation fails
   */
  static create(
    player: Player,
    typeId: string,
    location?: Vector3
  ): BlockHolder {
    if (!player.isValid)
      throw new Error("Cannot create BlockHolder: player is invalid");

    const dimension = player.dimension;
    const spawnLocation = location || player.location;
    let entity: Entity | undefined;

    try {
      if (!dimension.isChunkLoaded(spawnLocation))
        throw new Error(
          "Cannot create BlockHolder: chunk is not loaded at the spawn location"
        );

      // Spawn the fake block entity in the specified dimension
      entity = player.dimension.spawnEntity(
        "blockforce:fake_block",
        spawnLocation
      );
      if (!entity.isValid)
        throw new Error("Failed to create BlockHolder: entity is invalid");

      // Create the BlockHolder wrapper
      const holder = new BlockHolder(entity, typeId);

      // Cache it for future lookups
      cachedHolders.set(holder.entity.id, holder);

      return holder;
    } catch (error) {
      if (entity?.isValid) {
        try {
          entity.remove();
        } catch (removeError) {
          console.warn(
            `Failed to remove incomplete BlockHolder: ${removeError}`
          );
        }
      }
      throw new Error(`Failed to create BlockHolder: ${error}`);
    }
  }
}

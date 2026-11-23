import { Entity, Vector2, Vector3 } from "@minecraft/server";

/**
 * Gets the direction vector from a rotation in degrees.
 * @param rotation The rotation in degrees.
 * @returns A Vector3 representing the direction.
 */
export function directionFromRotation(rotation: Vector2): Vector3 {
  const pitch = (rotation.x * Math.PI) / 180;
  const yaw = (rotation.y * Math.PI) / 180;
  return {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: -Math.sin(pitch),
    z: Math.cos(yaw) * Math.cos(pitch)
  };
}

/**
 * Calculates a new location based on a position, rotation, and distance.
 * @param position The starting position.
 * @param rotation The rotation in degrees.
 * @param distance The distance to move in the direction of the rotation.
 * @returns A new Vector3 location.
 */
export function getForwardLocation(
  position: Vector3,
  rotation: Vector2,
  distance: number
): Vector3 {
  const direction = directionFromRotation(rotation);
  return {
    x: position.x + direction.x * distance,
    y: position.y + direction.y * distance,
    z: position.z + direction.z * distance
  };
}

/**
 * Adds rotation to an entity's custom properties.
 * @param entity The entity to modify.
 * @param dx Change in x rotation (pitch).
 * @param dy Change in y rotation (yaw).
 * @param dz Change in z rotation (roll).
 */
export function addRotation(entity: Entity, dx = 0, dy = 0, dz = 0) {
  if (!entity.isValid || entity.typeId !== "blockforce:fake_block") return;

  const rotationX =
    (Number(entity.getProperty("blockforce:rotation_x") ?? 0) + dx) % 360;
  const rotationY =
    (Number(entity.getProperty("blockforce:rotation_y") ?? 0) + dy) % 360;
  const rotationZ =
    (Number(entity.getProperty("blockforce:rotation_z") ?? 0) + dz) % 360;

  entity.setProperty("blockforce:rotation_x", rotationX);
  entity.setProperty("blockforce:rotation_y", rotationY);
  entity.setProperty("blockforce:rotation_z", rotationZ);
}

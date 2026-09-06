/**
 * STAFF PROFILE — Mindbody `staff.*` payload -> a Firestore patch.
 *
 * Pure by design: no Firestore, no network, no clock. Every interesting
 * decision in here is a field-name guess or a "should this overwrite?" call,
 * and both are much easier to get right when they can be unit tested.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * ------------------------------------
 * A trainer document holds two very different kinds of fact:
 *
 *   Journey-owned   role, pinHash, brandColor, initials, studio access,
 *                   bio, certifications, kaizenRoster, rollups
 *   Mindbody-owned  legal name, work email, staff photo, active flag
 *
 * The sync writes ONLY into the nested `mindbody` map. A `staff.updated`
 * event therefore cannot change someone's role, their studio access or their
 * PIN, however Mindbody spells its fields today or next year. The UI decides
 * what to display from the map; the map decides nothing about permissions.
 *
 * Mindbody spells the same field several ways across event types and schema
 * versions (the client handler in ./index.ts has the same problem), so every
 * read here accepts a list of spellings rather than one.
 */

export type StaffPatch = {
  /** Keys to merge under the trainer document's `mindbody` map. */
  mindbody: Record<string, unknown>;
  /** The event says this staff member is no longer active at the site. */
  deactivated: boolean;
};

function pickString(
  source: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const v = source[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

function pickBoolean(
  source: Record<string, unknown>,
  ...keys: string[]
): boolean | undefined {
  for (const key of keys) {
    const v = source[key];
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const t = v.trim().toLowerCase();
      if (t === "true" || t === "active") return true;
      if (t === "false" || t === "inactive" || t === "deactivated") return false;
    }
  }
  return undefined;
}

/** A location can arrive as a number, a string, or `{ id | Id | locationId }`. */
function pickLocationId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return pickString(obj, "id", "Id", "locationId", "LocationId");
  }
  return undefined;
}

/** The staff id an event is about, or undefined when it names none. */
export function extractStaffId(payload: Record<string, unknown>): string | undefined {
  const data = (payload.eventData as Record<string, unknown> | undefined) ||
    (payload.eventInstance as Record<string, unknown> | undefined) ||
    payload;
  return pickString(data, "staffId", "StaffId", "id", "Id");
}

/**
 * Builds the patch for a staff event.
 *
 * Absent fields are OMITTED rather than written as null. Mindbody sends
 * partial payloads -- `staff.deactivated` in particular carries little more
 * than an id -- and writing nulls for everything it left out would wipe the
 * name and photo captured at creation time.
 */
export function mapStaffEventToPatch(
  payload: Record<string, unknown>,
  eventType: string,
): StaffPatch {
  const data = (payload.eventData as Record<string, unknown> | undefined) ||
    (payload.eventInstance as Record<string, unknown> | undefined) ||
    payload;

  const mindbody: Record<string, unknown> = {};

  const staffId = pickString(data, "staffId", "StaffId", "id", "Id");
  if (staffId) mindbody.staffId = staffId;

  const siteId = pickString(data, "siteId", "SiteId") || pickString(payload, "siteId", "SiteId");
  if (siteId) mindbody.siteId = siteId;

  const firstName = pickString(data, "firstName", "FirstName");
  if (firstName) mindbody.firstName = firstName;

  const lastName = pickString(data, "lastName", "LastName");
  if (lastName) mindbody.lastName = lastName;

  const displayName =
    pickString(data, "displayName", "DisplayName", "name", "Name") ||
    (firstName || lastName ? `${firstName || ""} ${lastName || ""}`.trim() : undefined);
  if (displayName) mindbody.displayName = displayName;

  const email = pickString(data, "email", "Email");
  if (email) mindbody.email = email;

  // Only https. An http image URL would be blocked as mixed content anyway,
  // and a non-URL string here would render as a broken avatar forever.
  const imageUrl = pickString(data, "imageUrl", "ImageUrl", "imageURL", "photoUrl", "PhotoUrl");
  if (imageUrl && /^https:\/\//i.test(imageUrl)) mindbody.imageUrl = imageUrl;

  const homeLocationId =
    pickLocationId(data.homeLocation) ??
    pickLocationId(data.HomeLocation) ??
    pickString(data, "homeLocationId", "HomeLocationId");
  if (homeLocationId) mindbody.homeLocationId = homeLocationId;

  const rawLocations = data.locationIds ?? data.LocationIds ?? data.locations ?? data.Locations;
  if (Array.isArray(rawLocations)) {
    const ids = rawLocations
      .map((entry) => pickLocationId(entry))
      .filter((id): id is string => !!id);
    if (ids.length > 0) mindbody.locationIds = ids;
  }

  const lowerType = eventType.toLowerCase();
  const explicitlyInactive = pickBoolean(data, "isActive", "IsActive", "active", "status");
  const deactivated = lowerType.endsWith(".deactivated") || explicitlyInactive === false;

  if (deactivated) mindbody.isActive = false;
  else if (explicitlyInactive === true) mindbody.isActive = true;

  mindbody.lastEventType = eventType;

  return { mindbody, deactivated };
}

import { getLineClient } from "./client";

export type LineProfile = { lineDisplayName: string; linePictureUrl?: string };

/** Throws when LINE rejects the lookup (unfollowed/blocked user, bad token, ...). */
export async function fetchLineProfile(userId: string): Promise<LineProfile> {
  const profile = await getLineClient().getProfile(userId);
  return { lineDisplayName: profile.displayName, linePictureUrl: profile.pictureUrl };
}

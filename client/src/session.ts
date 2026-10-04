import type { Animal } from "@trivia/shared";

/** What the phone remembers so it can rejoin after a reload or a locked screen. */
export interface SavedSession {
  code: string;
  token: string | null;
  name: string;
  animal: Animal;
}

const KEY = "trivia_party_session";

export function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: SavedSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Private mode or storage blocked: rejoining after a reload won't work, everything else does.
  }
}

export function forgetToken(): void {
  const session = loadSession();
  if (session) saveSession({ ...session, token: null });
}

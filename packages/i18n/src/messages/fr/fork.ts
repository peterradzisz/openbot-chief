// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/fork";

// Fork: no translations yet; the fork strings fall back to English. See docs/FORK.md.
export const messages = {} as const satisfies PartialTranslation<typeof source>;

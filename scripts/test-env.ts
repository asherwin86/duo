// Loaded before any test: a throwaway storage folder, so no test can write into the real `storage/`.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DUO_STORAGE = mkdtempSync(join(tmpdir(), 'duo-test-storage-'))

# Persistence and Privacy

Tool content is potentially secret and ephemeral by default. Passwords,
tokens, OTP secrets, private keys, JWTs, certificates, documents, diffs, and
pasted configuration must not enter general local persistence, logs, analytics,
CDNs, or third-party services.

Harmless preferences use namespaced, versioned, size-bounded storage. Approved
content persistence must be opt-in, documented, clearable, and resilient to
migration, quota, parse, write, and rollback failures. Large state belongs in
IndexedDB rather than synchronous per-keystroke `localStorage`.

The Local Encrypted OTP Vault is the deliberate exception: encrypted records
live in IndexedDB, keys are derived/unwrapped with Web Crypto, plaintext stays
in memory only while unlocked, and there are no accounts or synchronization.
Locking, timeout, close, migration failure, or cryptographic failure clears
decrypted state.

Local LLM Playground has a separate non-content cache exception. After an
explicit Load, Transformers.js may store only fixed public model/runtime
responses plus a completion marker in `it-tools-local-llm-models-v1`. The user
can remove the selected model from the tool. Prompts, system instructions,
generated text, model selection, and generation options remain memory-only;
unmount terminates the worker and clears text state. Model responses originate
only from the same-origin pinned static mirror; no tool content or model request
is sent to Hugging Face at runtime.

Development PWA cleanup may unregister only the root IT Tools `sw.js` and delete
only `workbox-precache-*`, `it-tools-lazy-assets-*`, and `figlet-fonts-*`. It
must not clear local/session content or unrelated origins/caches.

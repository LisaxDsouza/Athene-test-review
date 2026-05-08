# Future Work / TO-DOs

## Authentication & RBAC
- [ ] **Department Assignment on Auto-Provisioning**: Currently, when users with the `bi_analyst` or `member` role are auto-provisioned into the database, their department (`dept_id`) is left empty/null. We need to implement a mechanism or UI to assign default department names/IDs during or immediately after this auto-provisioning process.

## Agents & LLM
- [x] **ATH-22**: Refactor `email-agent` and `calendar-agent` to use the new dynamic `resolveModelClient()` factory instead of the deprecated `getModel()` method. This will ensure they automatically fetch and use the organization's BYOK key instead of falling back to the hardcoded `.env` keys.

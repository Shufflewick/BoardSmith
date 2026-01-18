# Requirements: BoardSmith

**Defined:** 2026-01-18
**Core Value:** Make board game development fast and correct

## v1.2 Requirements

Requirements for Local Tarballs milestone.

### CLI Command

- [x] **CLI-01**: `boardsmith pack` command exists and is callable
- [x] **CLI-02**: Command discovers all public packages in monorepo
- [x] **CLI-03**: Command runs `npm pack` on each discovered package
- [x] **CLI-04**: Tarballs use timestamp-based version (e.g., `1.2.0-20260118123456`)
- [x] **CLI-05**: Tarballs are collected in output directory

### Target Integration

- [ ] **TGT-01**: `--target <path>` flag accepts path to consumer project
- [ ] **TGT-02**: Creates `vendor/` directory in target if missing
- [ ] **TGT-03**: Copies all tarballs to target's `vendor/` directory
- [ ] **TGT-04**: Updates target's `package.json` dependencies to `file:./vendor/*.tgz`
- [ ] **TGT-05**: Runs `npm install` in target after updating package.json

## Out of Scope

| Feature | Reason |
|---------|--------|
| npm publish | Tarballs are for local development only |
| workspace: protocol | file: protocol is simpler and more compatible |
| Version selection | Always pack current state, manual versioning |
| Selective package packing | Pack all public packages, keep it simple |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CLI-01 | Phase 37 | Complete |
| CLI-02 | Phase 37 | Complete |
| CLI-03 | Phase 37 | Complete |
| CLI-04 | Phase 37 | Complete |
| CLI-05 | Phase 37 | Complete |
| TGT-01 | Phase 38 | Pending |
| TGT-02 | Phase 38 | Pending |
| TGT-03 | Phase 38 | Pending |
| TGT-04 | Phase 38 | Pending |
| TGT-05 | Phase 38 | Pending |

**Coverage:**
- v1.2 requirements: 10 total
- Mapped to phases: 10
- Unmapped: 0 ✓

---
*Requirements defined: 2026-01-18*
*Last updated: 2026-01-18 after initial definition*

# Migration Guide: v1.x to v2.0

BoardSmith 2.0 consolidates all `@boardsmith/*` packages into a single `boardsmith` package with subpath exports.

## Step 1: Update package.json

Remove all @boardsmith/* dependencies and add boardsmith:

```diff
{
  "dependencies": {
-   "@boardsmith/engine": "^1.x",
-   "@boardsmith/ui": "^1.x",
-   "@boardsmith/session": "^1.x",
-   "@boardsmith/testing": "^1.x",
-   "@boardsmith/ai": "^1.x"
+   "boardsmith": "^2.0.0"
  }
}
```

## Step 2: Update Imports

Find and replace these import paths throughout your codebase:

| Find | Replace |
|------|---------|
| `from '@boardsmith/engine'` | `from 'boardsmith'` |
| `from '@boardsmith/ui'` | `from 'boardsmith/ui'` |
| `from '@boardsmith/session'` | `from 'boardsmith/session'` |
| `from '@boardsmith/testing'` | `from 'boardsmith/testing'` |
| `from '@boardsmith/ai'` | `from 'boardsmith/ai'` |
| `from '@boardsmith/ai-trainer'` | `from 'boardsmith/ai-trainer'` |
| `from '@boardsmith/client'` | `from 'boardsmith/client'` |
| `from '@boardsmith/server'` | `from 'boardsmith/server'` |
| `from '@boardsmith/runtime'` | `from 'boardsmith/runtime'` |
| `from '@boardsmith/worker'` | `from 'boardsmith/worker'` |
| `from '@boardsmith/eslint-plugin'` | `from 'boardsmith/eslint-plugin'` |
| `'@boardsmith/ui/animation/drag-drop.css'` | `'boardsmith/ui/animation/drag-drop.css'` |
| `'@boardsmith/ui/animation/card-flip.css'` | `'boardsmith/ui/animation/card-flip.css'` |

### Quick Find/Replace Commands

For VS Code:
- Open Find and Replace (Cmd+Shift+H / Ctrl+Shift+H)
- Enable regex mode
- Find: `from '@boardsmith/engine'`
- Replace: `from 'boardsmith'`
- Repeat for each package

For CLI (sed):
```bash
# macOS
find src -name "*.ts" -o -name "*.vue" | xargs sed -i '' "s/@boardsmith\\/engine/boardsmith/g"
find src -name "*.ts" -o -name "*.vue" | xargs sed -i '' "s/@boardsmith\\//boardsmith\\//g"

# Linux
find src -name "*.ts" -o -name "*.vue" | xargs sed -i "s/@boardsmith\\/engine/boardsmith/g"
find src -name "*.ts" -o -name "*.vue" | xargs sed -i "s/@boardsmith\\//boardsmith\\//g"
```

## Step 3: Reinstall Dependencies

```bash
rm -rf node_modules package-lock.json
npm install
```

## Step 4: Verify

```bash
# Build should succeed
npm run build

# Tests should pass
npm test

# Dev server should work
boardsmith dev
```

## Common Issues

### TypeScript errors about missing types

Make sure your tsconfig.json has:
```json
{
  "compilerOptions": {
    "moduleResolution": "bundler"
  }
}
```

### Import not found errors

The package uses source-based exports. Your bundler (Vite) compiles the TypeScript directly. This is the expected setup.

## Questions?

Contact the BoardSmith team if you hit issues.

# LaTeX Language Features - Agent Instructions

## Mission

**Reuse and adapt** existing code from `latex-workshop` extension (`vscode/resources/extensions/latex-workshop/`) to `latex-language-features` extension (`vscode/extensions/latex-language-features/`) by **wrapping it in a client-server architecture** that works in **both web and Electron**.

**DO NOT rewrite from scratch** - maximize code reuse from the existing extension.

## Critical Requirements

1. **Reuse Existing Code**: Copy and adapt code from `latex-workshop` instead of rewriting
2. **Client-Server Wrapper**: Wrap existing code in client-server architecture
3. **Web + Electron Compatible**: Adapt code to work in browser AND desktop
4. **Piece-by-Piece Migration**: Migrate one feature at a time, reusing its code
5. **Minimal Changes**: Make only necessary adaptations for architecture and compatibility

## Architecture Pattern

### Structure
```
latex-language-features/
├── client/
│   ├── src/
│   │   ├── node/clientMain.ts      # Electron entry
│   │   ├── browser/clientMain.ts    # Web entry
│   │   └── [feature code]
│   └── tsconfig.json
├── server/
│   ├── src/
│   │   ├── node/serverMain.ts       # Node.js server
│   │   ├── browser/serverMain.ts    # Web Worker server
│   │   └── [feature code]
│   └── tsconfig.json
└── package.json
```

### Entry Points (package.json)
- `"main"`: `./client/out/node/clientMain` (Electron)
- `"browser"`: `./client/dist/browser/clientMain` (Web)

## Migration Strategy: Reuse First, Adapt Second

### 1. Locate and Copy Source Code
- **Find source files** in `latex-workshop/extension/out/src/` (compiled JS) or source TypeScript if available
- **Copy entire modules** to appropriate location in `latex-language-features`
- **Preserve structure**: Keep similar directory structure when possible
- **Copy dependencies**: Include utility files, types, and helpers

### 2. Identify Reusable Components

**Directly Reusable (copy as-is or with minimal changes):**
- Parsing logic (AST, tokenization)
- Data structures and types
- Utility functions (string manipulation, path helpers)
- Configuration schemas
- Data files (JSON, snippets)

**Needs Adaptation (wrap or refactor):**
- VS Code API calls (vscode.* → connection.* or client adapters)
- File system operations (fs → vscode.workspace.fs or LSP)
- Process execution (child_process → platform abstraction)
- Extension context usage

### 3. Create Client-Server Wrapper

**Strategy**: Wrap existing code with LSP client-server layer, don't rewrite the core logic.

**Node.js Server** (`server/src/node/serverMain.ts`):
```typescript
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { LaTeXWorkshopFeature } from './latex-workshop-feature'; // Reused code

const connection = createConnection(ProposedFeatures.all);

// Wrap existing feature with LSP interface
const feature = new LaTeXWorkshopFeature(connection);

connection.onRequest('latex/build', async (params) => {
    // Delegate to existing code
    return await feature.build(params.uri);
});

connection.listen();
```

**Browser Server** (`server/src/browser/serverMain.ts`):
```typescript
import { createConnection, BrowserMessageReader, BrowserMessageWriter } from 'vscode-languageserver/browser';
import { LaTeXWorkshopFeature } from './latex-workshop-feature'; // Same reused code

const reader = new BrowserMessageReader(self);
const writer = new BrowserMessageWriter(self);
const connection = createConnection(reader, writer);

// Same wrapper pattern
const feature = new LaTeXWorkshopFeature(connection);
// ... same handlers

connection.listen();
```

### 4. Adapt VS Code API Calls

**Pattern for adapting vscode.* API:**

```typescript
// Original code (latex-workshop):
import * as vscode from 'vscode';
const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri);
const config = vscode.workspace.getConfiguration('latex-workshop');

// Adapted for server:
import { Connection } from 'vscode-languageserver';
const doc = connection.documents.get(uri);
const config = await connection.workspace.getConfiguration({ section: 'latex' });

// Adapted for client:
import * as vscode from 'vscode';
const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri);
const config = vscode.workspace.getConfiguration('latex');
```

### 5. Create Adapter Layer

Instead of rewriting, create adapters that translate between old and new APIs:

```typescript
// server/src/adapters/vscodeAdapter.ts
// Adapts vscode.* API to LSP connection API
export class VSCodeAdapter {
    constructor(private connection: Connection) {}

    async getTextDocument(uri: string) {
        return this.connection.documents.get(uri);
    }

    async getConfiguration(section: string) {
        return await this.connection.workspace.getConfiguration({ section });
    }

    // ... more adapters
}

// Then in reused code:
// Replace: vscode.workspace.getTextDocument()
// With: adapter.getTextDocument()
```

### 6. Platform Abstraction for Node.js-Only Code

**For code using fs, child_process, etc.:**

```typescript
// Copy existing implementation to server/src/node/
import { LaTeXCompiler } from '../../latex-workshop/compile'; // Reused code

// Create browser version that uses WASM or delegates
// server/src/browser/compiler.ts
export class BrowserLaTeXCompiler {
    // Use WASM or call Node server if available
    async compile(uri: string) {
        // Browser-compatible implementation
    }
}

// Platform abstraction
export function createCompiler(platform: 'node' | 'browser') {
    if (platform === 'node') {
        return new LaTeXCompiler(); // Reused code
    } else {
        return new BrowserLaTeXCompiler();
    }
}
```

## Web Compatibility Rules

### ❌ DO NOT USE in browser code:
- `fs`, `path`, `child_process` modules
- `process.env`, `__dirname`, `__filename`
- Node.js-specific globals

### ✅ USE INSTEAD:
- `vscode.workspace.fs` for file operations
- `vscode-uri` for URI handling
- Web Workers for background processing
- Browser-compatible APIs

## Code Reuse Patterns

### Pattern 1: Direct Copy with Minimal Changes

**When**: Pure logic, no VS Code API dependencies
```typescript
// Copy entire file from latex-workshop/extension/out/src/parse/parser.ts
// to latex-language-features/server/src/parse/parser.ts
// Change imports if needed, but keep logic intact
```

### Pattern 2: Wrap with Adapter

**When**: Uses vscode.* API that needs LSP translation
```typescript
// Original (latex-workshop):
class Feature {
    constructor(private context: vscode.ExtensionContext) {}
    async build(uri: vscode.Uri) {
        const doc = vscode.workspace.textDocuments.find(...);
        // ... existing logic
    }
}

// Adapted (latex-language-features):
class Feature {
    constructor(private adapter: VSCodeAdapter) {} // Adapter layer
    async build(uri: string) {
        const doc = await this.adapter.getTextDocument(uri);
        // ... same existing logic, minimal changes
    }
}
```

### Pattern 3: Extract and Adapt

**When**: Mixed concerns (UI + logic)
```typescript
// Extract pure logic from latex-workshop
// Keep in server/src/
// Create thin client wrapper that calls server via LSP
```

### Pattern 4: Platform-Specific Wrappers

**When**: Node.js-only code (fs, child_process)
```typescript
// Keep original in server/src/node/ (works as-is)
// Create browser version in server/src/browser/ that:
//   - Uses WASM for computation
//   - Delegates to Node server if available
//   - Uses Web APIs where possible
```

## Common Adaptations

### File Reading
```typescript
// Original (latex-workshop):
import * as fs from 'fs';
const content = fs.readFileSync(path, 'utf8');

// Reuse in Node server (keep as-is):
import * as fs from 'fs';
const content = fs.readFileSync(path, 'utf8');

// Adapt for browser server:
const response = await fetch(uri);
const content = await response.text();
```

### Process Execution
```typescript
// Original (latex-workshop):
import { exec } from 'child_process';
exec('pdflatex file.tex', callback);

// Reuse in Node server (keep as-is):
import { exec } from 'child_process';
exec('pdflatex file.tex', callback);

// Adapt for browser (use WASM or delegate):
// Browser: Use WASM LaTeX compiler or call Node server
```

### Configuration
```typescript
// Original (latex-workshop):
const config = vscode.workspace.getConfiguration('latex-workshop');

// Adapt for client (similar):
const config = vscode.workspace.getConfiguration('latex');

// Adapt for server:
const config = await connection.workspace.getConfiguration({ section: 'latex' });
```

### Diagnostics
```typescript
// Original (latex-workshop):
diagnosticCollection.set(uri, diagnostics);

// Adapt for server:
connection.sendDiagnostics({ uri, diagnostics });
```

## Reference Extensions

Study these for patterns:
- `vscode/extensions/json-language-features/` - Full example
- `vscode/extensions/markdown-language-features/` - Good patterns
- `vscode/extensions/html-language-features/` - Another reference

## Quick Checklist

- [ ] Feature identified in `latex-workshop/extension/out/src/`
- [ ] Source code files located and understood
- [ ] Reusable code identified (logic, parsers, utilities)
- [ ] Code copied to appropriate location
- [ ] VS Code API calls adapted (vscode.* → LSP or adapter)
- [ ] Adapter layer created if needed
- [ ] Client wrapper created (calls server via LSP)
- [ ] Server wrapper created (Node + Browser)
- [ ] Platform-specific code abstracted (Node vs Browser)
- [ ] Configuration adapted
- [ ] Commands registered
- [ ] Tested in Electron
- [ ] Tested in Web
- [ ] Feature parity verified

## Key Principles

1. **Reuse First**: Copy and adapt existing code, don't rewrite
2. **Minimal Changes**: Only modify what's necessary for architecture/compatibility
3. **Adapter Pattern**: Create adapters to translate APIs, not rewrite logic
4. **Separation of Concerns**: Wrap existing code in client-server, keep logic intact
5. **Platform Abstraction**: Abstract only Node.js-specific parts, reuse rest
6. **Type Safety**: Preserve existing types, add new ones only when needed
7. **Incremental Migration**: Migrate feature-by-feature, reusing each piece

## Code Reuse Priority

1. **High Priority (Copy directly)**:
   - Parsers and AST logic
   - Data structures and types
   - Utility functions
   - Configuration schemas
   - Data files (JSON, snippets)

2. **Medium Priority (Copy + Adapt)**:
   - Business logic with VS Code API calls
   - File operations (adapt to LSP)
   - Configuration access (adapt to LSP)

3. **Low Priority (Rewrite only if necessary)**:
   - Extension activation code
   - Command registration
   - UI-specific code (move to client)

## When in Doubt

1. **Check source first**: Look in `latex-workshop/extension/out/src/` for existing implementation
2. **Copy before adapting**: Get the code working first, then optimize
3. **Use adapters**: Don't rewrite, create translation layers
4. **Preserve logic**: Keep the core algorithms and data structures intact
5. **Test incrementally**: Verify each piece works before moving to next
6. **Reference extensions**: Check `json-language-features` for client-server patterns
7. **Reuse over rewrite**: Always prefer copying and adapting over creating from scratch


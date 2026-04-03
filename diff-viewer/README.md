# Diff Viewer

A desktop app to view git changes in a project folder, built with Tauri + React.

## Prerequisites

Make sure you have these installed:

- [Node.js](https://nodejs.org/) (v18 or higher)
- [Rust](https://rustup.rs/)
- [Tauri CLI prerequisites](https://tauri.app/start/prerequisites/) for your OS
- [Git](https://git-scm.com/)

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/jana-unwita/Tauri.git
cd Tauri
```

### 2. Install dependencies

```bash
npm install
```

### 3. Run in development mode

```bash
npm run tauri dev
```

### 4. Build for production

```bash
npm run tauri build
```

The compiled app will be in `src-tauri/target/release/`.

## How to Use

1. Click **Open Folder** — select any project folder
2. Make sure the folder has git initialized (`git init` if not)
3. Make your changes to the files
4. Click **Diff** — see all changed files listed
5. Click a file header to expand and view the diff
6. Click a changed file in the left panel to jump to its diff

## Notes

- Only works with local git repositories (no remote needed)
- Compares current working files against the last commit (`git diff HEAD`)
- New untracked files are also shown after running `git status`

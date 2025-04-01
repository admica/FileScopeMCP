# FileScopeMCP (Model Context Protocol) Server

**✨ Instantly understand and visualize your codebase structure & dependencies! ✨**

<!-- Add Badges Here (e.g., License, Version, Build Status) -->
[![Build Status](https://github.com/admica/FileScopeMCP/actions/workflows/build.yml/badge.svg)](https://github.com/admica/FileScopeMCP/actions)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.x-green)](https://nodejs.org/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
<!-- Add other badges -->

A TypeScript-based tool for ranking files in your codebase by importance, tracking dependencies, and providing summaries to help understand code structure.

## Overview

This MCP server analyzes your codebase to identify the most important files based on dependency relationships. It generates importance scores (0-10) for each file, tracks bidirectional dependencies, and allows you to add custom summaries for files. All this information is made available to AI tools through Cursor's Model Context Protocol.

## Features

🚀 **Supercharge your Code Understanding!** FileScopeMCP provides insights directly to your AI assistant:

- **🎯 File Importance Analysis**
  - Rank files on a 0-10 scale based on their role in the codebase.
  - Calculate importance using incoming/outgoing dependencies.
  - Instantly pinpoint the most critical files in your project.
  - Smart calculation considers file type, location, and name significance.

- **🔗 Dependency Tracking**
  - Map bidirectional dependency relationships between files.
  - Identify which files import a given file (dependents).
  - See which files are imported by a given file (dependencies).
  - Distinguish between local and package dependencies.
  - Multi-language support: Python, JavaScript, TypeScript, C/C++, Rust, Lua, Zig.

- **📊 Visualization**
  - Generate Mermaid diagrams to visualize file relationships.
  - Color-coded visualization based on importance scores.
  - Support for dependency graphs, directory trees, or hybrid views.
  - HTML output with embedded rendering including theme toggle and responsive design.
  - Customize diagram depth, filter by importance, and adjust layout options.

- **📝 File Summaries**
  - Add human or AI-generated summaries to any file.
  - Retrieve stored summaries to quickly grasp file purpose.
  - Summaries persist across server restarts.

- **📚 Multiple Project Support**
  - Create and manage multiple file trees for different project areas.
  - Configure separate trees with distinct base directories.
  - Switch between different file trees effortlessly.
  - Cached trees for faster subsequent operations.

- **💾 Persistent Storage**
  - All data automatically saved to disk in JSON format.
  - Load existing file trees without rescanning the filesystem.
  - Track when file trees were last updated.

## Installation

1. Clone this repository
2. Build the project:

   The build script will install all node dependencies and generate mcp.json for you.

   Windows:
   ```bash
   build.bat
   ```

   Linux:
   ```bash
   build.sh
   ```
3. Copy the generated mcp.json configuration to your project's `.cursor` directory:

   For Windows:
   ```json
   {
     "mcpServers": {
       "FileScopeMCP": {
         "command": "node",
         "args": ["<build script sets this>/mcp-server.js","--base-dir=C:/Users/admica/my/project/base"],
         "transport": "stdio"
       }
     }
   }
   ```
   
   If your Cursor project is in WSL:
   ```json
   {
     "mcpServers": {
       "FileScopeMCP": {
       "command": "wsl",
       "args": ["-d", "Ubuntu-24.04", "/home/admica/FileScopeMCP/run.sh", "--base-dir=/some/path"],
       "transport": "stdio",
       "disabled": false,
       "alwaysAllow": []
       }
     }
    }
    ```
4. Update the arg path --base-dir to your project's base path.

## How It Works

### Dependency Detection

The tool scans source code for import statements and other language-specific patterns:
- Python: `import` and `from ... import` statements
- JavaScript/TypeScript: `import` statements and `require()` calls
- C/C++: `#include` directives
- Rust: `use` and `mod` statements
- Lua: `require` statements
- Zig: `@import` directives

### Importance Calculation

Files are assigned importance scores (0-10) based on a weighted formula that considers:
- Number of files that import this file (dependents)
- Number of files this file imports (dependencies)
- File type and extension (with TypeScript/JavaScript files getting higher base scores)
- Location in the project structure (files in `src/` are weighted higher)
- File naming (files like 'index', 'main', 'server', etc. get additional points)

A file that is central to the codebase (imported by many files) will have a higher score.

### Diagram Generation

The system uses a three-phase approach to generate valid Mermaid syntax:
1. Collection Phase: Register all nodes and relationships
2. Node Definition Phase: Generate definitions for all nodes before any references
3. Edge Generation Phase: Create edges between defined nodes

This ensures all diagrams have valid syntax and render correctly. HTML output includes:
- Responsive design that works on any device
- Light/dark theme toggle with system preference detection
- Client-side Mermaid rendering for optimal performance
- Timestamp of generation

### Path Normalization

The system handles various path formats to ensure consistent file identification:
- Windows and Unix path formats
- Absolute and relative paths
- URL-encoded paths
- Cross-platform compatibility

### File Storage

All file tree data is stored in JSON files with the following structure:
- Configuration metadata (filename, base directory, last updated timestamp)
- Complete file tree with dependencies, dependents, importance scores, and summaries

## Technical Details

- **TypeScript/Node.js**: Built with TypeScript for type safety and modern JavaScript features
- **Model Context Protocol**: Implements the MCP specification for integration with Cursor
- **Mermaid.js**: Uses Mermaid syntax for diagram generation
- **JSON Storage**: Uses simple JSON files for persistence
- **Path Normalization**: Cross-platform path handling to support Windows and Unix
- **Caching**: Implements caching for faster repeated operations

## Available Tools

The MCP server exposes the following tools:

### File Tree Management

- **list_saved_trees**: List all saved file trees
- **create_file_tree**: Create a new file tree configuration for a specific directory
- **select_file_tree**: Select an existing file tree to work with
- **delete_file_tree**: Delete a file tree configuration

### File Analysis

- **list_files**: List all files in the project with their importance rankings
- **get_file_importance**: Get detailed information about a specific file, including dependencies and dependents
- **find_important_files**: Find the most important files in the project based on configurable criteria
- **read_file_content**: Read the content of a specific file
- **recalculate_importance**: Recalculate importance values for all files based on dependencies

### File Summaries

- **get_file_summary**: Get the stored summary of a specific file
- **set_file_summary**: Set or update the summary of a specific file

### File Watching

- **toggle_file_watching**: Toggle file watching on/off
- **get_file_watching_status**: Get the current status of file watching
- **update_file_watching_config**: Update file watching configuration

### Diagram Generation

- **generate_diagram**: Create Mermaid diagrams with customizable options
  - Output formats: Mermaid text (`.mmd`) or HTML with embedded rendering
  - Diagram styles: default, dependency, directory, or hybrid views
  - Filter options: max depth, minimum importance threshold
  - Layout options: direction (TB, BT, LR, RL), node spacing, rank spacing

## Usage Examples

### Analyzing a Project

1. Create a file tree for your project:
   ```
   create_file_tree(filename: "my-project.json", baseDirectory: "/path/to/project")
   ```

2. Find the most important files:
   ```
   find_important_files(limit: 5, minImportance: 5)
   ```

3. Get detailed information about a specific file:
   ```
   get_file_importance(filepath: "/path/to/project/src/main.ts")
   ```

### Working with Summaries

1. Read a file's content to understand it:
   ```
   read_file_content(filepath: "/path/to/project/src/main.ts")
   ```

2. Add a summary to the file:
   ```
   set_file_summary(filepath: "/path/to/project/src/main.ts", summary: "Main entry point that initializes the application, sets up routing, and starts the server.")
   ```

3. Retrieve the summary later:
   ```
   get_file_summary(filepath: "/path/to/project/src/main.ts")
   ```

### Generating Diagrams

1. Create a basic project structure diagram:
   ```
   generate_diagram(style: "directory", maxDepth: 3, outputPath: "diagrams/project-structure", outputFormat: "mmd")
   ```

2. Generate an HTML diagram with dependency relationships:
   ```
   generate_diagram(style: "hybrid", maxDepth: 2, minImportance: 5, showDependencies: true, outputPath: "diagrams/important-files", outputFormat: "html")
   ```

3. Customize the diagram layout:
   ```
   generate_diagram(style: "dependency", layout: { direction: "LR", nodeSpacing: 50, rankSpacing: 70 }, outputPath: "diagrams/dependencies", outputFormat: "html")
   ```

### Using File Watching

1. Enable file watching for your project:
   ```
   toggle_file_watching()
   ```

2. Check the current file watching status:
   ```
   get_file_watching_status()
   ```

3. Update file watching configuration:
   ```
   update_file_watching_config(config: { 
     debounceMs: 500, 
     autoRebuildTree: true,
     watchForNewFiles: true,
     watchForDeleted: true,
     watchForChanged: true
   })
   ```

## Future Improvements

- Add support for more programming languages
- Implement real-time file system monitoring
- Add more sophisticated importance calculation algorithms
- Enhance diagram customization options
- Support for exporting diagrams to additional formats

## License

This project is licensed under the GNU General Public License v3 (GPL-3.0). See the [LICENSE](LICENSE) file for the full license text.

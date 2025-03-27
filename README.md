# File Rank MCP (Model Context Protocol) Server

A TypeScript-based tool for ranking files in your codebase by importance, tracking dependencies, and providing summaries to help understand code structure.

## Overview

This MCP server analyzes your codebase to identify the most important files based on dependency relationships. It generates importance scores (0-10) for each file, tracks bidirectional dependencies, and allows you to add custom summaries for files. All this information is made available to AI tools through Cursor's Model Context Protocol.

## Features

- **File Importance Analysis**
  - Rank files on a scale from 0-10 based on their importance in the codebase
  - Calculate importance based on both incoming and outgoing dependencies
  - Find the most critical files in your project instantly
  - Smart importance calculation based on file type, location, and name significance

- **Dependency Tracking**
  - Track bidirectional dependency relationships between files
  - Identify which files import a given file (dependents)
  - See which files are imported by a given file (dependencies)
  - Distinguish between local dependencies and package dependencies
  - Support for multiple languages including Python, JavaScript, TypeScript, C/C++, Rust, Lua, and Zig

- **File Summaries**
  - Add human or AI-generated summaries to files
  - Retrieve stored summaries to quickly understand file purpose
  - Summaries persist across server restarts

- **Multiple Project Support**
  - Create and manage multiple file trees for different parts of your project
  - Configure separate file trees with different base directories
  - Switch between different file trees as needed
  - Cached file trees for faster subsequent operations

- **Persistent Storage**
  - All data is automatically saved to disk in JSON format
  - Load existing file trees without rescanning the filesystem
  - Track when file trees were last updated

## Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```
4. Create a Cursor MCP configuration in your project's `.cursor` directory:
   ```json
   {
     "mcpServers": {
       "file-rank-mcp": {
         "command": "node",
         "args": ["path/to/dist/mcp-server.js"],
         "transport": "stdio"
       }
     }
   }
   ```

## Available Tools

The MCP server exposes the following tools:

### File Tree Management

- **list_saved_trees**: List all saved file trees
- **create_file_tree**: Create a new file tree configuration for a specific directory
- **select_file_tree**: Select an existing file tree to work with

### File Analysis

- **list_files**: List all files in the project with their importance rankings
- **get_file_importance**: Get detailed information about a specific file, including dependencies and dependents
- **find_important_files**: Find the most important files in the project based on configurable criteria
- **read_file_content**: Read the content of a specific file

### File Summaries

- **get_file_summary**: Get the stored summary of a specific file
- **set_file_summary**: Set or update the summary of a specific file

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
- **JSON Storage**: Uses simple JSON files for persistence
- **Path Normalization**: Cross-platform path handling to support Windows and Unix
- **Caching**: Implements caching for faster repeated operations

## Future Improvements

- Add support for more programming languages
- Implement real-time file system monitoring
- Add visualization tools for dependency graphs
- Integrate with version control systems to track importance over time
- Add more sophisticated importance calculation algorithms

## License

This project is licensed under the GNU General Public License v3 (GPL-3.0). See the [LICENSE](LICENSE) file for the full license text.

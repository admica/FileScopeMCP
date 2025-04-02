import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { Config, FileWatchingConfig } from './types.js';

// Define the FileWatchingConfig schema
const FileWatchingSchema = z.object({
  enabled: z.boolean().default(false),
  debounceMs: z.number().int().positive().default(300),
  ignoreDotFiles: z.boolean().default(true),
  autoRebuildTree: z.boolean().default(true),
  maxWatchedDirectories: z.number().int().positive().default(1000),
  watchForNewFiles: z.boolean().default(true),
  watchForDeleted: z.boolean().default(true),
  watchForChanged: z.boolean().default(true)
}).optional();

// Define the config schema
const ConfigSchema = z.object({
  baseDirectory: z.string(),
  excludePatterns: z.array(z.string()),
  fileWatching: FileWatchingSchema,
  version: z.string()
});

// Verify the schema matches our Config type
type ValidateConfig = z.infer<typeof ConfigSchema> extends Config ? true : false;

const DEFAULT_CONFIG: Config = {
  baseDirectory: "",
  excludePatterns: [],
  fileWatching: {
    enabled: false,
    debounceMs: 300,
    ignoreDotFiles: true,
    autoRebuildTree: true,
    maxWatchedDirectories: 1000,
    watchForNewFiles: true,
    watchForDeleted: true,
    watchForChanged: true
  },
  version: "1.0.0"
};

export async function loadConfig(configPath: string = 'config.json'): Promise<Config> {
  console.error(`\n🔧 LOADING CONFIG from ${configPath}`);
  console.error(`  - Current working directory: ${process.cwd()}`);
  
  try {
    const fullPath = path.resolve(configPath);
    console.error(`  - Resolved full path: ${fullPath}`);
    
    const exists = await fs.access(fullPath).then(() => true).catch(() => false);
    console.error(`  - Config file exists: ${exists ? '✅ YES' : '❌ NO'}`);
    
    if (!exists) {
      console.error(`  - ! Using default config instead`);
      console.error(`  - Default config:`, JSON.stringify(DEFAULT_CONFIG, null, 2));
      return DEFAULT_CONFIG;
    }
    
    const configContent = await fs.readFile(configPath, 'utf-8');
    console.error(`  - Read ${configContent.length} bytes from config file`);
    
    try {
      const parsedConfig = JSON.parse(configContent);
      console.error(`  - Parsed config successfully`);
      
      // Check for exclude patterns
      if (parsedConfig.excludePatterns && Array.isArray(parsedConfig.excludePatterns)) {
        console.error(`  - Found ${parsedConfig.excludePatterns.length} exclude patterns`);
        if (parsedConfig.excludePatterns.length > 0) {
          console.error(`  - First 5 patterns:`, parsedConfig.excludePatterns.slice(0, 5));
        }
      } else {
        console.error(`  - ! No exclude patterns found in config!`);
      }
      
      // Validate config
      const validatedConfig = ConfigSchema.parse(parsedConfig);
      console.error(`  - Config validation successful`);
      console.error(`  - Base directory: ${validatedConfig.baseDirectory}`);
      console.error(`  - Version: ${validatedConfig.version}`);
      console.error(`+ CONFIG LOADED SUCCESSFULLY\n`);
      
      return validatedConfig;
    } catch (parseError) {
      console.error(`  - x ERROR parsing config JSON:`, parseError);
      console.error(`  - Raw config content:`, configContent);
      console.error(`  - ! Using default config instead`);
      return DEFAULT_CONFIG;
    }
  } catch (error) {
    console.error(`  - x ERROR loading config:`, error);
    console.error(`  - ! Using default config instead`);
    console.error(`  - Default config:`, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: Config, configPath: string = 'config.json'): Promise<void> {
  try {
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Error saving config:', error);
    throw error;
  }
} 
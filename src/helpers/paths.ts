import os from 'os';
import path from 'path';
import fs from 'fs';
import yargsParser from 'yargs-parser';

const argv = yargsParser(process.argv.slice(2));

export const contextDir = async (pathParts) => {
  const baseDir = os.homedir();
  let context = argv.context;

  let finalPathParts: string[] = [];

  // Check if context argument is defined
  if (context) {
    const isAbsolute = path.isAbsolute(context);
    
    if (!isAbsolute) {
      // If context is not absolute, resolve it relative to the current working directory
      context = path.resolve(process.cwd(), context);
    }

    // Ensure the context directory exists
    if (!fs.existsSync(context)) {
      console.error(`Context directory does not exist: ${context}`);
      process.exit(1);
    }
    
    // Use the context as base and add pathParts
    finalPathParts = [context].concat(pathParts || []);
  } else {
    // Use default: home folder + "lab34-flows" + pathParts
    finalPathParts = [baseDir, 'lab34-flows'].concat(pathParts || []);
  }

  const finalPath = path.join.apply(null, finalPathParts);
  return finalPath;
};

/**
 * The context directory itself: where every flow, application and config file
 * of this run lives.
 * @returns {Promise<string>} Absolute path
 */
export const contextRoot = async () => contextDir([]);

/**
 * Whether the context directory was chosen with --context, rather than being
 * the default one under the home folder. The UI says so, because "which
 * folder am I looking at" is a different question in each case.
 * @returns {boolean}
 */
export const hasCustomContext = () => Boolean(argv.context);

export const createFolder = async (folderPath) => {
  // create if not exists
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
};

export const findFiles = (dir, depth = 0, maxDepth = 4, results: string[] = [], formats?) => {
  if (depth > maxDepth) {return results;}

  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);

      if (item.isDirectory()) {
        findFiles(fullPath, depth + 1, maxDepth, results);
      } else if (item.isFile()) {
        if (!formats) {
          results.push(fullPath);
          return; 
        }

        const fileName = path.basename(item.name);
        const fileFormat = (fileName.split('.').pop()||'').toLowerCase();
        if (formats.includes(fileFormat)) {
          results.push(fullPath);
        }
      }
    }
  } catch (err) {
    console.error(`Error reading directory "${dir}":`, err.message);
  }

  return results;
};

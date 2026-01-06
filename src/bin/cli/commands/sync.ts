import { Command } from 'commander';

import { isValidVerbosity } from '@/domains/logger/types';
import { MkNotes } from '@/MkNotes';

const COMMAND_NAME = 'sync';
const COMMAND_DESCRIPTION =
  'Synchronize a markdown file or directory to a dedicated notion page';

const command = new Command();

command.name(COMMAND_NAME);
command.description(COMMAND_DESCRIPTION);

command.option(
  '-i, --input <path>',
  'Path of the markdown file or directory to synchronize'
);

command.requiredOption(
  '-d, --destination <notionPageUrl>',
  'Url of the parent notion page to store the synchronized file'
);

command.requiredOption(
  '-k, --notion-api-key <notionApiKey>',
  'The Notion API to use to launch the synchronization'
);

command.option(
  '-c, --clean',
  'Clean sync - WARNING: removes ALL existing content from the destination page before syncing, including any custom content not created by mk-notes'
);

command.option('-l, --lock', 'Lock the Notion page after syncing');

command.option('-s, --save-id', 'Save the page ID to the source repository');

command.option('-f, --force-new', 'Force a new page to be created');

command.option('--flat', 'Flatten the result page tree');

command.option(
  '--delete-file <filePath>',
  'Delete a Notion page by file path (queries database for pages with matching md-file property)'
);

command.option('-v, --verbosity <verbosity>', 'Verbosity level', 'error');
interface SyncOptions {
  input?: string;
  destination: string;
  notionApiKey: string;
  clean?: boolean;
  lock?: boolean;
  saveId?: boolean;
  verbosity?: string;
  forceNew?: boolean;
  flat?: boolean;
  deleteFile?: string;
}

command.action(async (opts: SyncOptions) => {
  const {
    input: inputPath,
    destination: notionParentPageUrl,
    notionApiKey,
    clean = false,
    lock = false,
    saveId = false,
    forceNew = false,
    verbosity = 'error',
    flat = false,
    deleteFile,
  } = opts;

  if (!isValidVerbosity(verbosity)) {
    throw new Error(`Invalid verbosity: ${verbosity}`);
  }

  const mkNotes = new MkNotes({
    notionApiKey,
    LOG_LEVEL: verbosity,
  });

  // Handle file deletion
  if (deleteFile) {
    // eslint-disable-next-line no-console
    console.log(`Deleting Notion page for file: ${deleteFile}`);
    await mkNotes.deletePageByFilePath({
      filePath: deleteFile,
      parentNotionPageId: notionParentPageUrl,
    });
    // eslint-disable-next-line no-console
    console.log(`Successfully deleted Notion page for file: ${deleteFile}`);
    return;
  }

  // Normal sync flow - input is required
  if (!inputPath) {
    throw new Error('Input path is required for sync (use --input or -i)');
  }

  await mkNotes.synchronizeMarkdownToNotionFromFileSystem({
    inputPath: inputPath,
    parentNotionPageId: notionParentPageUrl,
    cleanSync: clean,
    lockPage: lock,
    saveId: saveId,
    forceNew: forceNew,
    flatten: flat,
  });

  // eslint-disable-next-line no-console
  console.log(
    `Synchronization done.\nView the result at ${notionParentPageUrl}`
  );
});

export default command;

if (require.main === module) {
  command
    .parseAsync()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}

import { Client } from '@notionhq/client';
import {
  BlockObjectResponse,
  DatabaseObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import winston from 'winston';

import { PageElement } from '@/domains/elements/entities/Element';
import { NotionPage } from '@/domains/notion/entities/NotionPage';
import {
  isNotionNestingValidationError,
  NotionNestingValidationError,
} from '@/domains/notion/error';
import { NotionClientRepository } from '@/domains/notion/repositories/notion-client.repository';
import {
  BlockObjectRequest,
  BlockObjectRequestWithoutChildren,
  DatabaseProperty,
  Icon,
  Parent,
} from '@/domains/notion/types';
import {
  DestinationRepository,
  ObjectType,
  PageLockedStatus,
} from '@/domains/synchronization/repositories/destination.repository';
import { NotionConverterRepository } from '@/infrastructure/converters/notion/notion.converter';

interface ListBlockChildrenResponse {
  results: BlockObjectResponse[];
  has_more: boolean;
  next_cursor: string | null;
}

interface NotionClientRepositoryWithClient extends NotionClientRepository {
  client: Client;
}

export interface UpdatePageInput {
  pageId: string;
  blocks?: BlockObjectRequest[] | BlockObjectRequestWithoutChildren[];
  title?: string;
  icon?: Icon;
}

export class NotionDestinationRepository
  implements DestinationRepository<NotionPage>
{
  private notionClient: NotionClientRepository;
  private logger: winston.Logger;
  private notionConverter: NotionConverterRepository;

  constructor({
    logger,
    notionClient,
    notionConverter,
  }: {
    notionClient: NotionClientRepository;
    logger: winston.Logger;
    notionConverter: NotionConverterRepository;
  }) {
    this.notionClient = notionClient;
    this.logger = logger;
    this.notionConverter = notionConverter;
  }

  /**
   * Delete all child blocks from a parent page
   * Handles pagination to ensure all blocks are deleted
   */
  async deleteChildBlocks({
    parentPageId,
  }: {
    parentPageId: string;
  }): Promise<void> {
    try {
      // Get all blocks in the parent page, handling pagination
      // Notion API returns blocks in pages of up to 100, so we need to paginate
      const allBlocks: string[] = [];
      let startCursor: string | undefined = undefined;
      let hasMore = true;

      // Access the underlying Notion client to handle pagination
      // The NotionClientRepository interface doesn't expose pagination, so we need
      // to access the implementation's client property
      const notionClientImpl = this
        .notionClient as NotionClientRepositoryWithClient;
      if (!notionClientImpl?.client) {
        throw new Error('Notion client implementation does not expose client');
      }

      while (hasMore) {
        const response = (await notionClientImpl.client.blocks.children.list({
          block_id: parentPageId,
          start_cursor: startCursor,
        })) as ListBlockChildrenResponse;

        allBlocks.push(...response.results.map((block) => block.id));
        hasMore = response.has_more;
        startCursor = response.next_cursor ?? undefined;
      }

      // Delete all blocks in batches if needed (Notion API may have limits)
      if (allBlocks.length > 0) {
        // Delete in batches of 100 to avoid API limits
        const batchSize = 100;
        for (let i = 0; i < allBlocks.length; i += batchSize) {
          const batch = allBlocks.slice(i, i + batchSize);
          await this.notionClient.deleteBlocks({
            blockIds: batch,
          });
        }
      }
    } catch (error: unknown) {
      // Deletion failed - throw the error to be handled upstream
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  getObjectIdFromObjectUrl({ objectUrl }: { objectUrl: string }): string {
    const urlObj = new URL(objectUrl);

    // Notion IDs are 32-character hexadecimal strings (UUID without dashes)
    // They can be embedded in path segments like "MK-Notes-4dd0bd3dc73648a9a55dcf05dd03080f"
    const notionIdRegex = /[a-f0-9]{32}/gi;
    const matches = urlObj.pathname.match(notionIdRegex);

    if (!matches || matches.length === 0) {
      throw new Error('Invalid Notion URL: No valid Notion ID found');
    }

    // Return the last match (closest to the end of the URL path)
    return matches[matches.length - 1];
  }

  async destinationIsAccessible({
    parentObjectId,
  }: {
    parentObjectId: string;
  }): Promise<boolean> {
    let page: NotionPage | null = null;

    try {
      page = await this.notionClient.getPage({ pageId: parentObjectId });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_err) {
      // Discard error, we'll check if it's a database
    }

    if (page) {
      return true;
    }

    let database: DatabaseObjectResponse | null = null;
    try {
      database = await this.notionClient.getDatabaseById({
        databaseId: parentObjectId,
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_err) {
      // Discard error, we'll check if it's a page
    }

    if (database) {
      return true;
    }

    return false;
  }

  async getPage({ pageId }: { pageId: string }): Promise<NotionPage | null> {
    const notionPage = await this.notionClient.getPage({
      pageId,
    });

    if (!notionPage) {
      return null;
    }

    const blocks = await this.notionClient.getPageBlocks({ pageId: pageId });

    notionPage.children = blocks;

    return notionPage;
  }

  private async getAvailablePropertiesFromDatabase(
    databaseId: string
  ): Promise<DatabaseProperty[]> {
    this.logger.debug(`Getting properties from database: ${databaseId}`);

    const availableProperties: DatabaseProperty[] = [];

    const datasourceId = await this.notionClient.getDataSourceIdFromDatabaseId({
      databaseId,
    });

    if (!datasourceId) {
      this.logger.debug(`No datasource found for database: ${databaseId}`);
      return availableProperties;
    }

    this.logger.debug(`Found datasource: ${datasourceId}`);

    const datasource = await this.notionClient.getDataSourceById({
      dataSourceId: datasourceId,
    });

    if (!datasource) {
      this.logger.debug(`Datasource ${datasourceId} not found`);
      return availableProperties;
    }

    availableProperties.push(
      ...Object.entries(datasource.properties).map(([name, property]) => ({
        name,
        definition: property,
        type: property.type,
      }))
    );

    this.logger.debug(
      `Extracted ${availableProperties.length} properties from datasource: ${availableProperties.map((p) => `${p.name} (${p.type})`).join(', ')}`
    );
    return availableProperties;
  }

  async createPage({
    parentObjectId,
    parentObjectType,
    pageElement,
  }: {
    parentObjectId: string;
    parentObjectType: ObjectType;
    pageElement: PageElement;
  }): Promise<NotionPage> {
    if (parentObjectType === 'unknown') {
      throw new Error('Unknown parent object type');
    }

    let parent: Parent | undefined;
    const availableProperties: DatabaseProperty[] = [];

    if (parentObjectType === 'page') {
      parent = { type: 'page_id', page_id: parentObjectId };
    }

    if (parentObjectType === 'database') {
      const datasourceId =
        await this.notionClient.getDataSourceIdFromDatabaseId({
          databaseId: parentObjectId,
        });

      if (!datasourceId) {
        throw new Error('Failed to get Datasource');
      }

      parent = { type: 'data_source_id', data_source_id: datasourceId };

      const properties =
        await this.getAvailablePropertiesFromDatabase(parentObjectId);
      availableProperties.push(...properties);
    }

    const notionPage = await this.notionConverter.convertFromElement(
      pageElement,
      availableProperties
    );

    // First create the page without children
    const createdPage = await this.notionClient.createPage({
      parent,
      properties: notionPage.properties ?? {},
      icon: notionPage.icon,
      children: [],
    });

    if (!createdPage.pageId) {
      throw new Error('Failed to create Notion Page');
    }

    // If there are children blocks, append them in chunks
    if (notionPage.children && notionPage.children.length > 0) {
      const children = notionPage.children as BlockObjectRequest[];

      const createdBlocks = await this.notionClient.appendChildToBlock({
        blockId: createdPage.pageId,
        children: children,
      });

      createdPage.children = createdBlocks;

      // Append children to toggle headings after they're created
      // This is needed because Notion API doesn't allow nested children inline
      if (notionPage.toggleHeadingChildren?.length > 0) {
        for (const {
          index,
          children: toggleChildren,
        } of notionPage.toggleHeadingChildren) {
          const createdBlock = createdBlocks[index];

          if (createdBlock && toggleChildren.length > 0) {
            this.logger.debug(
              `Appending ${toggleChildren.length} children to toggle heading block ${createdBlock.id}`
            );
            await this.notionClient.appendChildToBlock({
              blockId: createdBlock.id,
              children: toggleChildren,
            });
          }
        }
      }
    }

    const page = await this.getPage({
      pageId: createdPage.pageId,
    });

    if (!page) {
      throw new Error('Failed to create Notion Page');
    }

    return page;
  }

  private async getAvailablePropertiesForPage(
    pageId: string
  ): Promise<DatabaseProperty[]> {
    this.logger.debug(`Getting available properties for page: ${pageId}`);

    // Get the page to check its parent
    const page = await this.notionClient.getPage({ pageId });

    if (!page) {
      this.logger.debug(`Page ${pageId} not found`);
      return [];
    }

    // Access the raw page response to get parent info
    const notionClientWithClient = this
      .notionClient as NotionClientRepositoryWithClient;
    if (!notionClientWithClient.client) {
      this.logger.debug(`Notion client not available`);
      return [];
    }

    const pageResponse = await notionClientWithClient.client.pages.retrieve({
      page_id: pageId,
    });

    const parent = 'parent' in pageResponse ? pageResponse.parent : null;
    this.logger.debug(
      `Page parent type: ${parent && typeof parent === 'object' && 'type' in parent ? (parent as { type: string }).type : 'unknown'}`
    );

    // Check if parent is a data source (pages in databases have data_source_id parent)
    if (
      parent &&
      typeof parent === 'object' &&
      'type' in parent &&
      parent.type === 'data_source_id' &&
      'data_source_id' in parent
    ) {
      const dataSourceId = parent.data_source_id;
      this.logger.debug(`Page is in data source: ${dataSourceId}`);

      // Get datasource directly and extract properties
      const datasource = await this.notionClient.getDataSourceById({
        dataSourceId: dataSourceId,
      });

      if (!datasource) {
        this.logger.debug(`Datasource ${dataSourceId} not found`);
        return [];
      }

      const availableProperties: DatabaseProperty[] = Object.entries(
        datasource.properties
      ).map(([name, property]) => ({
        name,
        definition: property,
        type: property.type,
      }));

      this.logger.debug(
        `Extracted ${availableProperties.length} properties from datasource: ${availableProperties.map((p) => `${p.name} (${p.type})`).join(', ')}`
      );
      return availableProperties;
    }

    // Check if parent is a database (legacy or direct database parent)
    if (
      parent &&
      typeof parent === 'object' &&
      'type' in parent &&
      parent.type === 'database_id' &&
      'database_id' in parent
    ) {
      const databaseId = parent.database_id;
      this.logger.debug(`Page is in database: ${databaseId}`);

      const properties =
        await this.getAvailablePropertiesFromDatabase(databaseId);
      this.logger.debug(
        `Found ${properties.length} available properties for page`
      );
      return properties;
    }

    this.logger.debug(
      `Page is not in a database or data source, no properties available`
    );
    return [];
  }

  async updatePage({
    pageId,
    pageElement,
  }: {
    pageId: string;
    pageElement: PageElement;
  }): Promise<NotionPage> {
    const notionPageId = pageId;

    this.logger.debug(`Updating page: ${notionPageId}`);
    this.logger.debug(
      `PageElement has ${pageElement.properties?.length || 0} properties: ${JSON.stringify(pageElement.properties)}`
    );

    // Get available properties from the page's parent database
    const availableProperties =
      await this.getAvailablePropertiesForPage(notionPageId);

    this.logger.debug(
      `Available properties count: ${availableProperties.length}`
    );

    const notionPage = await this.notionConverter.convertFromElement(
      pageElement,
      availableProperties
    );

    this.logger.debug(
      `Converted properties: ${JSON.stringify(notionPage.properties, null, 2)}`
    );
    this.logger.debug(
      `Properties keys: ${Object.keys(notionPage.properties || {}).join(', ')}`
    );

    await this.notionClient.updatePage({
      pageId: notionPageId,
      icon: notionPage.icon,
      properties: notionPage.properties,
      archived: false,
    });

    let existingBlocks = await this.notionClient.getBlockChildren({
      blockId: notionPageId,
    });

    let afterBlockId: string | undefined;
    if (
      existingBlocks.length >= 2 &&
      existingBlocks[0].type === 'table_of_contents' &&
      existingBlocks[1].type === 'divider'
    ) {
      this.logger.warn(
        'First two blocks are TOC & Divider, appending to page after Divider'
      );
      afterBlockId = existingBlocks[1]?.id;
      existingBlocks = existingBlocks.slice(2);
    }

    // Remove all non-page blocks
    await this.removeNonPageBlocks({ blocks: existingBlocks });

    if (notionPage.children && notionPage.children?.length > 0) {
      let blocks = notionPage.children as BlockObjectRequest[];

      // Track offset if we skip TOC and divider blocks
      let indexOffset = 0;
      if (
        blocks.length >= 2 &&
        blocks[0]?.type === 'table_of_contents' &&
        blocks[1]?.type === 'divider'
      ) {
        blocks = blocks.slice(2);
        indexOffset = 2;
      }

      const createdBlocks = await this.notionClient.appendChildToBlock({
        blockId: notionPageId,
        children: blocks,
        afterBlockId: afterBlockId,
      });

      // Append children to toggle headings after they're created
      // This is needed because Notion API doesn't allow nested children inline
      if (notionPage.toggleHeadingChildren?.length > 0) {
        for (const { index, children } of notionPage.toggleHeadingChildren) {
          // Adjust index for the offset (skipped TOC/divider blocks)
          const adjustedIndex = index - indexOffset;
          const createdBlock = createdBlocks[adjustedIndex];

          if (createdBlock && children.length > 0) {
            this.logger.debug(
              `Appending ${children.length} children to toggle heading block ${createdBlock.id}`
            );
            await this.notionClient.appendChildToBlock({
              blockId: createdBlock.id,
              children: children,
            });
          }
        }
      }
    }

    await this.removeUnusedPageBlocks({ pageElement, blocks: existingBlocks });

    const page = await this.getPage({ pageId: notionPageId });

    if (!page) {
      throw new Error('Failed to update Notion Page');
    }
    return page;
  }

  private async removeNonPageBlocks({
    blocks,
  }: {
    blocks: BlockObjectResponse[];
  }): Promise<void> {
    const blockIdsToDelete = blocks
      .filter((block) => block.type !== 'child_page')
      .map((block) => block.id);

    await this.notionClient.deleteBlocks({
      blockIds: blockIdsToDelete,
    });
  }

  private async removeUnusedPageBlocks({
    pageElement,
    blocks,
  }: {
    pageElement: PageElement;
    blocks: BlockObjectResponse[];
  }): Promise<void> {
    const pageBlocks = blocks.filter((block) => block.type === 'child_page');
    const newPageBlocksIds = pageElement.content
      .filter((element) => element instanceof PageElement)
      .map((element) => element.id);

    const unusedPageBlocks = pageBlocks
      .filter((block) => !newPageBlocksIds.includes(block.id))
      .map((block) => block.id);

    await this.notionClient.deleteBlocks({
      blockIds: unusedPageBlocks,
    });
  }

  // Used for root level index.md where the page is already present
  async appendToPage({
    pageId,
    pageElement,
  }: {
    pageId: string;
    pageElement: PageElement;
  }): Promise<void> {
    const notionPage =
      await this.notionConverter.convertFromElement(pageElement);

    // Update page properties (title/icon) if specified in metadata
    await this.updatePageProperties({ pageId, pageElement });

    if (notionPage.children && notionPage.children.length > 0) {
      // Append blocks to the existing page
      try {
        await this.notionClient.appendChildToBlock({
          blockId: pageId,
          children: notionPage.children as BlockObjectRequest[],
        });
      } catch (error) {
        if (isNotionNestingValidationError(error)) {
          throw new NotionNestingValidationError({ message: 'Nesting error' });
        }

        this.logger.debug(`Failed to append block to page ${pageId}:`, {
          error,
          block: notionPage.children,
        });
        throw error;
      }
    }
  }

  async updatePageProperties({
    pageId,
    pageElement,
  }: {
    pageId: string;
    pageElement: PageElement;
  }): Promise<void> {
    this.logger.debug(`Updating page properties for: ${pageId}`);
    this.logger.debug(
      `PageElement has ${pageElement.properties?.length || 0} properties: ${JSON.stringify(pageElement.properties)}`
    );

    // Get available properties from the page's parent database
    const availableProperties =
      await this.getAvailablePropertiesForPage(pageId);

    this.logger.debug(
      `Available properties: ${availableProperties.map((p) => `${p.name} (${p.type})`).join(', ')}`
    );

    const notionPage = await this.notionConverter.convertFromElement(
      pageElement,
      availableProperties
    );

    this.logger.debug(
      `Converted properties: ${JSON.stringify(notionPage.properties, null, 2)}`
    );

    // Only update if there are properties to update
    if (notionPage.properties || notionPage.icon) {
      this.logger.debug(
        `Updating ${Object.keys(notionPage.properties || {}).length} properties`
      );
      await this.notionClient.updatePage({
        pageId,
        icon: notionPage.icon,
        properties: notionPage.properties,
      });
    } else {
      this.logger.debug(`No properties to update`);
    }
  }

  async setPageLockedStatus({
    pageId,
    lockStatus,
  }: {
    pageId: string;
    lockStatus: PageLockedStatus;
  }): Promise<void> {
    const isLocked = lockStatus === 'locked';

    await this.notionClient.updatePage({
      pageId,
      isLocked,
    });
  }

  async getPageLockedStatus({
    pageId,
  }: {
    pageId: string;
  }): Promise<PageLockedStatus> {
    const page = await this.notionClient.getPage({ pageId });

    if (!page) {
      throw new Error('Page not found');
    }

    const isLocked = page.isLocked ?? false;

    if (isLocked === undefined) {
      return 'unlocked';
    }

    return isLocked ? 'locked' : 'unlocked';
  }

  async getObjectType({
    id,
  }: {
    id: string;
  }): Promise<'page' | 'database' | 'unknown'> {
    try {
      await this.notionClient.getPage({ pageId: id });
      return 'page';
    } catch {
      try {
        await this.notionClient.getDatabaseById({ databaseId: id });
        return 'database';
      } catch {
        return 'unknown';
      }
    }
  }

  async queryDatabase({
    databaseId,
    filter,
  }: {
    databaseId: string;
    filter?: {
      property: string;
      value: string;
    };
  }): Promise<Array<{ pageId: string }>> {
    return this.notionClient.queryDatabase({
      databaseId,
      filter,
    });
  }

  async deletePage({ pageId }: { pageId: string }): Promise<void> {
    await this.notionClient.deletePage({ pageId });
  }
}

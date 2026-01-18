import {
  BlockObjectResponse,
  PartialBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';

import { Page } from '@/domains';
import {
  BlockObjectRequest,
  Icon,
  PageProperties,
  PartialCreatePageBodyParameters,
} from '@/domains/notion/types/types';

/**
 * Represents children that need to be appended to a toggle heading after it's created.
 * The index refers to the position of the toggle heading in the children array.
 */
export interface ToggleHeadingChildren {
  index: number;
  children: BlockObjectRequest[];
}

export class NotionPage implements Page {
  public readonly pageId?: string;
  public readonly icon?: Icon;
  public readonly title?: string;
  public readonly properties?: PageProperties;
  public children: (
    | BlockObjectResponse
    | PartialBlockObjectResponse
    | BlockObjectRequest
  )[];
  public readonly createdAt?: Date;
  public readonly updatedAt?: Date;
  public readonly isLocked?: boolean;
  /**
   * Map of toggle heading children that need to be appended after the heading is created.
   * This is needed because Notion API doesn't allow nested children in inline heading children.
   */
  public toggleHeadingChildren: ToggleHeadingChildren[] = [];

  constructor({
    pageId,
    children,
    createdAt,
    icon,
    updatedAt,
    properties,
    isLocked,
    toggleHeadingChildren,
  }: {
    pageId?: string;
    children: (
      | BlockObjectResponse
      | PartialBlockObjectResponse
      | BlockObjectRequest
    )[];
    createdAt?: Date;
    icon?: Icon;
    updatedAt?: Date;
    properties?: PageProperties;
    isLocked?: boolean;
    toggleHeadingChildren?: ToggleHeadingChildren[];
  }) {
    this.pageId = pageId;
    this.children = children;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt || createdAt;
    this.icon = icon;
    this.properties = properties;
    this.isLocked = isLocked;
    this.toggleHeadingChildren = toggleHeadingChildren ?? [];
  }

  static fromPartialCreatePageBodyParameters(
    args: PartialCreatePageBodyParameters
  ) {
    return new NotionPage({
      children: args.children ?? [],
      properties: args.properties,
      icon:
        args.icon !== undefined && args.icon !== null ? args.icon : undefined,
      // Notion page is not locked on creation
      isLocked: false,
    });
  }

  toCreatePageBodyParameters(): PartialCreatePageBodyParameters {
    return {
      children: this.children as BlockObjectRequest[],
      properties: this.properties as PageProperties,
      icon: this.icon,
    };
  }
}

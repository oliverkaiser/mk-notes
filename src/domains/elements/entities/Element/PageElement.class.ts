import { File } from '@/domains/synchronization';

import { SupportedEmoji } from '../../types';
import { Element } from './Element.class';
import { ElementType } from './types';

export type PageElementPropertyValue =
  | string
  | string[]
  | number
  | number[]
  | boolean
  | boolean[]
  | Date
  | null
  | undefined;

export interface PageElementProperties {
  name: string;
  value: PageElementPropertyValue;
}

/**
 * Element that represents the concept of page (in knowledge management systems)
 */
export class PageElement extends Element {
  public title: string;
  public icon?: SupportedEmoji;
  public content: Element[];
  public properties?: PageElementProperties[];
  public source?: File;
  /** Extra frontmatter keys not part of the known schema */
  public extraFrontmatter?: Record<string, unknown>;

  constructor({
    id,
    title,
    icon,
    content = [],
    properties,
    source,
    extraFrontmatter,
  }: {
    id?: string;
    title: string;
    icon?: SupportedEmoji;
    content: Element[];
    properties?: PageElementProperties[];
    source?: File;
    extraFrontmatter?: Record<string, unknown>;
  }) {
    super({ id, type: ElementType.Page });
    this.title = title;
    this.icon = icon;
    this.content = content;
    this.properties = properties;
    this.source = source;
    this.extraFrontmatter = extraFrontmatter;
  }

  public getIcon(): SupportedEmoji | undefined {
    return this.icon;
  }

  public addElementToBeginning(element: Element): void {
    this.content.unshift(element);
  }

  public addElementToEnd(element: Element): void {
    this.content.push(element);
  }
}

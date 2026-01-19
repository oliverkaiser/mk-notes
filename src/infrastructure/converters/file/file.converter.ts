import { Logger } from 'winston';

import {
  Element,
  ElementConverterRepository,
  PageElement,
  PageElementProperties,
  PageElementPropertyValue,
  ParserRepository,
  SupportedEmoji,
} from '@/domains/elements';
import { File } from '@/domains/synchronization';
import type { HtmlParser } from '@/infrastructure/parsers/html/html.parser';
import type { MarkdownParser } from '@/infrastructure/parsers/markdown/markdown.parser';

export class FileConverter
  implements ElementConverterRepository<PageElement, File>
{
  private htmlParser: HtmlParser;
  private markdownParser: MarkdownParser;
  private logger: Logger;

  constructor({
    htmlParser,
    markdownParser,
    logger,
  }: {
    htmlParser: HtmlParser;
    markdownParser: MarkdownParser;
    logger: Logger;
  }) {
    this.htmlParser = htmlParser;
    this.markdownParser = markdownParser;
    this.logger = logger;
  }

  public convertToElement(file: File): PageElement {
    const { content } = file;

    const args: {
      title: string;
      content: Element[];
      icon: SupportedEmoji | undefined;
    } = {
      title: file.name,
      content: [],
      icon: undefined,
    };

    let parser: ParserRepository | null = null;

    if (file.extension === 'md') {
      parser = this.markdownParser;
    }

    if (file.extension === 'html') {
      parser = this.htmlParser;
    }

    if (!parser) {
      throw new Error('File extension not supported');
    }

    const result = parser.parse({ content, filepath: file.path });

    return new PageElement({
      ...args,
      ...result,
      source: file,
    });
  }

  public convertFromElement(pageElement: PageElement): File {
    if (!pageElement.source || !(pageElement.source instanceof File)) {
      throw new Error(
        'Filepath is required to convert from PageElement to File'
      );
    }

    return new File({
      name: pageElement.title,
      extension: pageElement.source.extension,
      content: [
        this.getFrontmatterString(pageElement),
        this.removeFrontmatterFromContent(pageElement.source.content),
      ].join('\n'),
      lastUpdated: pageElement.source.lastUpdated,
      path: pageElement.source.path,
    });
  }

  private getFrontmatterString(pageElement: PageElement): string {
    const frontmatter: string[] = ['---'];

    if (pageElement.id) {
      frontmatter.push(`id: ${pageElement.id}`);
    }

    if (pageElement.title) {
      frontmatter.push(`title: ${pageElement.title}`);
    }

    if (pageElement.icon) {
      frontmatter.push(`icon: ${pageElement.icon}`);
    }

    if (pageElement.properties) {
      frontmatter.push('properties:');
      frontmatter.push(
        this.getPageElementPropertiesString(pageElement.properties)
      );
    }

    // Write extra frontmatter keys (not part of the known schema)
    if (pageElement.extraFrontmatter) {
      for (const [key, value] of Object.entries(pageElement.extraFrontmatter)) {
        frontmatter.push(
          `${key}: ${this.serializeExtraFrontmatterValue(value)}`
        );
      }
    }

    frontmatter.push('---');

    return frontmatter.join('\n');
  }

  /**
   * Serializes a value from extra frontmatter to a YAML-compatible string.
   */
  private serializeExtraFrontmatterValue(value: unknown): string {
    if (typeof value === 'string') {
      return this.quoteYamlStringIfNeeded(value);
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (value === null || value === undefined) {
      return 'null';
    }

    // For complex values (arrays, objects), use JSON stringification
    // which is valid YAML for simple structures
    return JSON.stringify(value);
  }

  private getPageElementPropertiesString(
    properties: PageElementProperties[]
  ): string {
    const propertiesString: string[] = [];

    if (!properties) {
      return '';
    }

    properties.forEach((property) => {
      propertiesString.push(
        ...[
          `  - name: ${property.name}`,
          `    value: ${this.getPropertyValueString(property.value)}`,
        ]
      );
    });

    return propertiesString.join('\n');
  }

  private getPropertyValueString(value: PageElementPropertyValue): string {
    if (typeof value === 'string') {
      return this.quoteYamlStringIfNeeded(value);
    }

    if (typeof value === 'number') {
      return value.toString();
    }

    if (typeof value === 'boolean') {
      return value.toString();
    }

    if (Array.isArray(value)) {
      return this.getPropertyValueStringArray(value);
    }

    // Handle Date objects
    if (value instanceof Date) {
      return value.toISOString();
    }

    if (value === null) {
      return 'null';
    }

    if (typeof value === 'undefined') {
      return 'undefined';
    }

    throw new Error(`Unsupported property value type: ${typeof value}`);
  }

  /**
   * Checks if a string needs to be quoted for valid YAML and quotes it if necessary.
   * Strings need quoting if they contain YAML special characters or patterns.
   */
  private quoteYamlStringIfNeeded(value: string): string {
    // Characters and patterns that require quoting in YAML
    const needsQuoting =
      // Contains YAML special characters
      /[[\]{}:#&*!|>'"%@`]/.test(value) ||
      // Starts with special characters
      /^[-?]/.test(value) ||
      // Has leading/trailing whitespace
      value !== value.trim() ||
      // Could be interpreted as a number, boolean, or null
      /^(true|false|null|~|[0-9.+-]+)$/i.test(value) ||
      // Empty string
      value === '';

    if (needsQuoting) {
      // Escape backslashes and double quotes, then wrap in double quotes
      const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `"${escaped}"`;
    }

    return value;
  }

  private getPropertyValueStringArray(
    value: PageElementPropertyValue[]
  ): string {
    return [
      `[`,
      value.map((v) => this.getPropertyValueString(v)).join(', '),
      `]`,
    ].join('');
  }

  private removeFrontmatterFromContent(content: string): string {
    return content.replace(/^-{3,}\n.*?\n-{3,}/s, '').trim();
  }
}

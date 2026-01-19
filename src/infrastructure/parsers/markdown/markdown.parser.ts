import fm from 'front-matter';
import { marked, Tokens } from 'marked';
import { default as markedKatex } from 'marked-katex-extension';
import { Logger } from 'winston';

import {
  CalloutElement,
  CodeElement,
  DividerElement,
  Element,
  ElementCodeLanguage,
  EquationElement,
  ImageElement,
  isElementCodeLanguage,
  LinkElement,
  ListItemElement,
  ParseResult,
  ParserRepository,
  QuoteElement,
  RichTextElement,
  SpecialCalloutType,
  SupportedEmoji,
  TableElement,
  TableOfContentsElement,
  TextElement,
  TextElementLevel,
} from '@/domains/elements';
import { HtmlParser } from '@/infrastructure/parsers/html';

import { EquationToken, ExtendedToken } from './types';

export interface MarkdownMetadata {
  id?: string;
  title?: string;
  icon?: string;
  properties?: Record<string, string>;
}

export class MarkdownParser extends ParserRepository {
  private htmlParser: HtmlParser;
  // Used during synchronous parse() call to provide context for image paths
  private parsingFilePath?: string;

  constructor({
    htmlParser,
    logger,
  }: {
    htmlParser: HtmlParser;
    logger: Logger;
  }) {
    super({ logger });
    this.htmlParser = htmlParser;

    marked.use(markedKatex({ throwOnError: false, nonStandard: true }));

    // Add custom extension for [table-of-contents] syntax
    marked.use({
      extensions: [
        {
          name: 'tableOfContents',
          level: 'block',
          start(src: string) {
            return src.match(/^\[table-of-contents\]/i)?.index;
          },
          tokenizer(src: string) {
            const match = /^\[table-of-contents\]/i.exec(src);
            if (match) {
              return {
                type: 'tableOfContents',
                raw: match[0],
              };
            }
            return undefined;
          },
          renderer() {
            return '';
          },
        },
      ],
    });
  }

  private preParseMarkdown(src: string): ExtendedToken[] {
    const { body } = fm(src);
    return marked.lexer(body);
  }

  getMetadata(src: string): MarkdownMetadata {
    const { attributes } = fm(src);

    if (!attributes || typeof attributes !== 'object') {
      return {};
    }

    return attributes;
  }

  private getTextLevelFromDepth(depth: number): TextElementLevel {
    const mapping: Record<number, TextElementLevel> = {
      1: TextElementLevel.Heading1,
      2: TextElementLevel.Heading2,
      3: TextElementLevel.Heading3,
      4: TextElementLevel.Heading4,
      5: TextElementLevel.Heading5,
      6: TextElementLevel.Heading6,
    };

    if (depth < 1 || depth > 6) {
      return TextElementLevel.Paragraph;
    }

    return mapping[depth];
  }

  /**
   * Parse a heading token
   * Supports toggle headings with syntax: # > Heading text
   */
  private parseHeadingToken(token: Tokens.Heading): TextElement {
    const level = this.getTextLevelFromDepth(token.depth);
    const isToggleable = token.text.startsWith('> ');
    const text = isToggleable ? token.text.slice(2) : token.text;

    return new TextElement({
      text,
      level,
      isToggleable,
    });
  }

  private parseListToken(token: Tokens.List): ListItemElement[] {
    return token.items.map((item) => {
      let text: RichTextElement = [];
      const children: Element[] = [];

      const paragraph = item.tokens.shift();

      if (paragraph && paragraph.type === 'text') {
        text = this.parseParagraphToken(paragraph as Tokens.Paragraph);
      }

      // Check if the list item has nested tokens (like nested lists)
      if (item.tokens) {
        for (const nestedToken of item.tokens) {
          const contentItem = this.parseToken(nestedToken);
          children.push(...contentItem);
        }
      }

      return new ListItemElement({
        listType: token.ordered ? 'ordered' : 'unordered',
        text,
        children: children.length > 0 ? children : undefined,
      });
    });
  }

  private parseBlockQuoteToken(
    token: Tokens.Blockquote
  ): QuoteElement | CalloutElement {
    const rawText = token.text.trim();

    // Check for special callout syntax first using raw text
    if (CalloutElement.isSpecialCalloutText(rawText)) {
      // Detect the callout type from raw text
      const calloutType = this.detectCalloutType(rawText);

      // Parse the content to get formatting
      const richText = this.parseBlockQuoteContent(token);

      // If we have rich text, strip the callout marker from the first element if it's text
      if (richText.length > 0) {
        const strippedRichText = this.stripCalloutMarkerFromRichText(richText);
        if (strippedRichText.length > 0) {
          return new CalloutElement({
            text: strippedRichText,
            calloutType,
          });
        }
      }

      // Fallback to raw text (constructor will strip marker and detect type)
      return new CalloutElement({
        text: rawText,
      });
    }

    // For regular quotes, parse inline formatting
    const richText = this.parseBlockQuoteContent(token);
    if (richText.length > 0) {
      return new QuoteElement({
        text: richText,
      });
    }

    return new QuoteElement({
      text: rawText,
    });
  }

  private detectCalloutType(text: string): SpecialCalloutType | undefined {
    const calloutMarkerRegex = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;
    const match = calloutMarkerRegex.exec(text);
    if (match) {
      const typeString = match[1].toLowerCase();
      const typeMap: Record<string, SpecialCalloutType> = {
        note: SpecialCalloutType.Note,
        tip: SpecialCalloutType.Tip,
        important: SpecialCalloutType.Important,
        warning: SpecialCalloutType.Warning,
        caution: SpecialCalloutType.Caution,
      };
      return typeMap[typeString];
    }
    return undefined;
  }

  private stripCalloutMarkerFromRichText(
    elements: RichTextElement
  ): RichTextElement {
    if (elements.length === 0) return elements;

    const calloutMarkerRegex =
      /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

    // Clone the array to avoid mutating the original
    const result: RichTextElement = [...elements];
    const [firstElement] = result;

    // Only strip from TextElement that contains the marker
    if (
      firstElement instanceof TextElement &&
      typeof firstElement.text === 'string'
    ) {
      const match = calloutMarkerRegex.exec(firstElement.text);
      if (match) {
        const strippedText = firstElement.text.slice(match[0].length);
        if (strippedText.length > 0) {
          result[0] = new TextElement({
            text: strippedText,
            styles: firstElement.styles,
          });
        } else {
          // Remove the first element if it becomes empty
          result.shift();
        }
      }
    }

    return result;
  }

  private parseBlockQuoteContent(token: Tokens.Blockquote): RichTextElement {
    const elements: RichTextElement = [];

    // Blockquote tokens contain block-level tokens (paragraphs, etc.)
    if (token.tokens) {
      for (const t of token.tokens) {
        if (t.type === 'paragraph') {
          elements.push(...this.parseParagraphToken(t as Tokens.Paragraph));
        } else if (t.type === 'text' && 'tokens' in t && t.tokens) {
          // Handle text tokens with nested tokens
          for (const nestedToken of t.tokens) {
            if (nestedToken.type === 'text') {
              elements.push(this.parseTextToken(nestedToken as Tokens.Text));
            } else if (nestedToken.type === 'strong') {
              elements.push(this.parseTextToken(nestedToken as Tokens.Strong));
            } else if (nestedToken.type === 'em') {
              elements.push(this.parseTextToken(nestedToken as Tokens.Em));
            } else if (nestedToken.type === 'del') {
              elements.push(this.parseTextToken(nestedToken as Tokens.Del));
            } else if (nestedToken.type === 'codespan') {
              elements.push(
                this.parseTextToken(nestedToken as Tokens.Codespan)
              );
            } else if (nestedToken.type === 'link') {
              elements.push(this.parseLinkToken(nestedToken as Tokens.Link));
            }
          }
        }
      }
    }

    return elements;
  }

  private parseCodeToken(token: Tokens.Code): CodeElement {
    const language = token.lang || ElementCodeLanguage.PlainText;

    if (language === 'js') {
      return new CodeElement({
        text: token.text,
        language: ElementCodeLanguage.JavaScript,
      });
    }

    const isSupportedLanguage = isElementCodeLanguage(language);

    if (!isSupportedLanguage) {
      return new CodeElement({
        text: token.text,
        language: ElementCodeLanguage.PlainText,
      });
    }

    return new CodeElement({
      text: token.text,
      language,
    });
  }

  private parseCalloutToken(token: Tokens.Generic): CalloutElement {
    if (!token.callout || typeof token.callout !== 'string') {
      throw new Error('Callout token does not have a callout property');
    }

    return new CalloutElement({
      text: token.callout,
      icon: '💡',
    });
  }

  private parseTableToken(token: Tokens.Table): TableElement {
    const headers = token.header.map((cell) => this.parseTableCellTokens(cell));
    const rows = token.rows.map((row) =>
      row.map((cell) => this.parseTableCellTokens(cell))
    );

    return new TableElement({
      rows: [headers, ...rows],
    });
  }

  private parseTableCellTokens(cell: Tokens.TableCell): RichTextElement {
    const elements: RichTextElement = [];

    cell.tokens.forEach((t) => {
      switch (t.type) {
        case 'text':
          elements.push(this.parseTextToken(t as Tokens.Text));
          break;
        case 'inlineKatex':
          elements.push(this.parseBlockKatexToken(t as EquationToken));
          break;
        case 'strong':
          elements.push(this.parseTextToken(t as Tokens.Strong));
          break;
        case 'em':
          elements.push(this.parseTextToken(t as Tokens.Em));
          break;
        case 'del':
          elements.push(this.parseTextToken(t as Tokens.Del));
          break;
        case 'codespan':
          elements.push(this.parseTextToken(t as Tokens.Codespan));
          break;
        case 'link':
          elements.push(this.parseLinkToken(t as Tokens.Link));
          break;
        case 'image':
          elements.push(this.parseImageToken(t as Tokens.Image));
          break;
      }
    });

    return elements;
  }

  private parseImageToken(token: Tokens.Image): ImageElement {
    return new ImageElement({
      url: token.href,
      caption: token.text,
      filepath: this.parsingFilePath,
    });
  }

  private parseHtmlToken(token: Tokens.HTML): Element[] {
    const { content } = this.htmlParser.parse({ content: token.text });

    return content;
  }

  private parseLinkToken(token: Tokens.Link): LinkElement {
    return new LinkElement({
      text: token.text,
      url: token.href,
      filepath: this.parsingFilePath,
    });
  }

  private parseTextToken(
    token:
      | Tokens.Text
      | Tokens.Strong
      | Tokens.Em
      | Tokens.Del
      | Tokens.Codespan
  ): TextElement {
    if (token.type === 'strong') {
      return new TextElement({
        text: token.text,
        styles: {
          bold: true,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
        },
      });
    }

    if (token.type === 'em') {
      return new TextElement({
        text: token.text,
        styles: {
          bold: false,
          italic: true,
          strikethrough: false,
          underline: false,
          code: false,
        },
      });
    }

    if (token.type === 'del') {
      return new TextElement({
        text: token.text,
        styles: {
          bold: false,
          italic: false,
          strikethrough: true,
          underline: false,
          code: false,
        },
      });
    }

    if (token.type === 'codespan') {
      return new TextElement({
        text: token.text,
        styles: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          code: true,
        },
      });
    }

    return new TextElement({
      text: token.text,
    });
  }

  private parseBlockKatexToken(token: EquationToken): EquationElement {
    return new EquationElement({
      equation: token.text,
      styles: {
        italic: false,
        bold: false,
        strikethrough: false,
        underline: false,
      },
    });
  }

  private parseRawText(text: string): RichTextElement {
    const tokens = this.preParseMarkdown(text);

    const elements: RichTextElement = [];

    for (const t of tokens) {
      switch (t.type) {
        case 'paragraph':
          elements.push(...this.parseParagraphToken(t as Tokens.Paragraph));
          break;
        case 'text':
          elements.push(this.parseTextToken(t as Tokens.Text));
          break;
      }
    }

    return elements;
  }

  private parseParagraphToken(token: Tokens.Paragraph): RichTextElement {
    const elements: RichTextElement = [];

    token.tokens.forEach((t) => {
      switch (t.type) {
        case 'text':
          elements.push(this.parseTextToken(t as Tokens.Text));
          break;
        case 'inlineKatex':
          elements.push(this.parseBlockKatexToken(t as EquationToken));
          break;
        case 'strong':
          elements.push(this.parseTextToken(t as Tokens.Strong));
          break;
        case 'em':
          elements.push(this.parseTextToken(t as Tokens.Em));
          break;
        case 'del':
          elements.push(this.parseTextToken(t as Tokens.Del));
          break;
        case 'codespan':
          elements.push(this.parseTextToken(t as Tokens.Codespan));
          break;
        case 'link':
          elements.push(this.parseLinkToken(t as Tokens.Link));
          break;
        case 'image':
          elements.push(this.parseImageToken(t as Tokens.Image));
          break;
      }
    });

    return elements;
  }
  private parseToken(token: ExtendedToken): Element[] {
    const elements: Element[] = [];

    switch (token.type) {
      case 'heading': {
        elements.push(this.parseHeadingToken(token as Tokens.Heading));
        break;
      }
      case 'paragraph': {
        if (token.tokens?.length === 1 && token.tokens[0].type === 'image') {
          elements.push(this.parseImageToken(token.tokens[0] as Tokens.Image));
        } else {
          elements.push(
            new TextElement({
              text: this.parseParagraphToken(token as Tokens.Paragraph),
              level: TextElementLevel.Paragraph,
            })
          );
        }

        break;
      }
      case 'text': {
        elements.push(this.parseTextToken(token as Tokens.Text));
        break;
      }
      case 'list':
        const listItems = this.parseListToken(token as Tokens.List);
        elements.push(...listItems);
        break;
      case 'blockquote': {
        elements.push(this.parseBlockQuoteToken(token as Tokens.Blockquote));
        break;
      }
      case 'code':
        elements.push(this.parseCodeToken(token as Tokens.Code));
        break;
      case 'callout':
        elements.push(this.parseCalloutToken(token));
        break;
      case 'table': {
        elements.push(this.parseTableToken(token as Tokens.Table));
        break;
      }
      case 'hr':
        elements.push(new DividerElement());
        break;
      case 'image':
        elements.push(this.parseImageToken(token as Tokens.Image));
        break;
      case 'html':
        elements.push(...this.parseHtmlToken(token as Tokens.HTML));
        break;
      case 'link':
        elements.push(this.parseLinkToken(token as Tokens.Link));
        break;
      case 'strong':
      case 'em':
      case 'del':
        elements.push(this.parseTextToken(token as Tokens.Strong | Tokens.Em));
        break;
      case 'blockKatex':
        elements.push(this.parseBlockKatexToken(token as EquationToken));
        break;
      case 'inlineKatex':
        elements.push(this.parseBlockKatexToken(token as EquationToken));
        break;
      case 'tableOfContents':
        elements.push(new TableOfContentsElement());
        break;
      default:
        break;
    }

    return elements;
  }

  /**
   * Get the heading depth from a token, or null if not a heading
   */
  private getHeadingDepth(token: ExtendedToken): number | null {
    if (token.type === 'heading') {
      return (token as Tokens.Heading).depth;
    }
    return null;
  }

  /**
   * Check if a heading token is a toggle heading (starts with "> ")
   */
  private isToggleHeading(token: ExtendedToken): boolean {
    if (token.type === 'heading') {
      return (token as Tokens.Heading).text.startsWith('> ');
    }
    return false;
  }

  parse({
    content,
    filepath,
  }: {
    content: string;
    filepath?: string;
  }): ParseResult {
    // Set the filepath context for use during this synchronous parse operation
    this.parsingFilePath = filepath;

    const tokens = this.preParseMarkdown(content);

    const elements: Element[] = [];

    let i = 0;
    while (i < tokens.length) {
      const token = tokens[i];

      // Handle toggle headings specially - collect children
      if (this.isToggleHeading(token)) {
        const headingDepth = this.getHeadingDepth(token)!;
        const headingElement = this.parseHeadingToken(token as Tokens.Heading);
        const children: Element[] = [];

        // Collect all following tokens until we hit a heading of same or higher level
        i++;
        while (i < tokens.length) {
          const nextToken = tokens[i];
          const nextDepth = this.getHeadingDepth(nextToken);

          // Stop if we hit a heading of same or higher level (lower depth number)
          if (nextDepth !== null && nextDepth <= headingDepth) {
            break;
          }

          // Parse and add as child
          children.push(...this.parseToken(nextToken));
          i++;
        }

        headingElement.children = children.length > 0 ? children : undefined;
        elements.push(headingElement);
      } else {
        elements.push(...this.parseToken(token));
        i++;
      }
    }

    const result: ParseResult = {
      content: elements,
    };

    const fileMetadata = this.getMetadata(content);

    if (fileMetadata.id) {
      result.id = fileMetadata.id;
    }

    if (fileMetadata.title) {
      result.title = fileMetadata.title;
    }

    if (fileMetadata.icon) {
      result.icon = fileMetadata.icon as SupportedEmoji;
    }

    if (fileMetadata.properties && Array.isArray(fileMetadata.properties)) {
      result.properties = fileMetadata.properties;
    }

    // Extract extra frontmatter keys (not part of the known schema)
    const knownKeys = new Set(['id', 'title', 'icon', 'properties']);
    const extraFrontmatter: Record<string, unknown> = {};
    for (const key of Object.keys(fileMetadata)) {
      if (!knownKeys.has(key)) {
        extraFrontmatter[key] = fileMetadata[key as keyof typeof fileMetadata];
      }
    }
    if (Object.keys(extraFrontmatter).length > 0) {
      result.extraFrontmatter = extraFrontmatter;
    }

    // Clear the filepath context after parsing
    this.parsingFilePath = undefined;

    return result;
  }
}

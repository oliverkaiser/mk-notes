import { Element } from './Element.class';
import { TextElementStyles } from './TextElement.types';
import { ElementType } from './types';

export class LinkElement extends Element {
  public url: string;
  public text: string;
  public caption?: string;
  public filepath?: string;
  public styles: TextElementStyles = {
    italic: false,
    bold: false,
    strikethrough: false,
    underline: false,
    code: false,
  };

  constructor({
    id,
    url,
    text,
    caption,
    filepath,
    styles,
  }: {
    id?: string;
    url: string;
    text: string;
    caption?: string;
    filepath?: string;
    styles?: {
      italic?: boolean;
      bold?: boolean;
      strikethrough?: boolean;
      underline?: boolean;
      code?: boolean;
    };
  }) {
    super({ id, type: ElementType.Link });
    this.url = url;
    this.text = text;
    this.caption = caption;
    this.filepath = filepath;
    this.styles.bold = styles?.bold || false;
    this.styles.italic = styles?.italic || false;
    this.styles.strikethrough = styles?.strikethrough || false;
    this.styles.underline = styles?.underline || false;
    this.styles.code = styles?.code || false;
  }

  public toContentString(): string {
    let label = this.text;
    if (this.styles.code) {
      label = `\`${label}\``;
    }
    if (this.styles.bold) {
      label = `**${label}**`;
    }
    if (this.styles.italic) {
      label = `_${label}_`;
    }
    if (this.styles.strikethrough) {
      label = `~~${label}~~`;
    }
    return `[${label}](${this.url})`;
  }
}

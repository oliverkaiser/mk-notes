import { Element } from './Element.class';
import { RichTextElement } from './TextElement.class';
import { ElementType } from './types';

export class QuoteElement extends Element {
  public text: string | RichTextElement;

  constructor({ id, text }: { id?: string; text: string | RichTextElement }) {
    super({ id, type: ElementType.Quote });
    this.text = text;
  }

  public toContentString(): string {
    if (typeof this.text === 'string') {
      return `> ${this.text}`;
    }
    const content = this.text.map((el) => el.toContentString()).join('');
    return `> ${content}`;
  }
}

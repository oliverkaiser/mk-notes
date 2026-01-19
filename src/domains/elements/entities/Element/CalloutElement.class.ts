import { SupportedEmoji } from '../../types';
import { Element } from './Element.class';
import { RichTextElement } from './TextElement.class';
import { ElementType } from './types';

const specialCalloutRegex =
  // eslint-disable-next-line no-useless-escape
  /^\s*\[\!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](.*)/ims;

export enum SpecialCalloutType {
  Note = 'note',
  Tip = 'tip',
  Important = 'important',
  Warning = 'warning',
  Caution = 'caution',
}

export class CalloutElement extends Element {
  public text: string | RichTextElement;
  private readonly icon?: SupportedEmoji;
  private readonly calloutType?: SpecialCalloutType;

  public static isSpecialCalloutText(text: string): boolean {
    return specialCalloutRegex.test(text.trim());
  }

  constructor({
    id,
    icon,
    text,
    calloutType,
  }: {
    id?: string;
    icon?: SupportedEmoji;
    text: string | RichTextElement;
    calloutType?: SpecialCalloutType;
  }) {
    super({ id, type: ElementType.Callout });

    this.icon = icon;
    this.text = text;

    // If callout type is explicitly provided, use it
    if (calloutType) {
      this.calloutType = calloutType;
      return;
    }

    // Only parse special callout type from string text
    if (typeof text === 'string') {
      const { text: parsedText, calloutType: parsedCalloutType } =
        this.getSpecialCalloutTypeAndText(text);

      if (parsedCalloutType) {
        this.calloutType = parsedCalloutType;
        this.text = parsedText;
      }
    }
  }

  private getSpecialCalloutTypeAndText(text: string): {
    calloutType: SpecialCalloutType | null;
    text: string;
  } {
    const textToSpecialCalloutType: Record<string, SpecialCalloutType> = {
      note: SpecialCalloutType.Note,
      tip: SpecialCalloutType.Tip,
      important: SpecialCalloutType.Important,
      warning: SpecialCalloutType.Warning,
      caution: SpecialCalloutType.Caution,
    };

    const match = specialCalloutRegex.exec(text.trim());

    if (match) {
      const typeString = match[1].toLowerCase() as SpecialCalloutType;
      const text = match[2].trim();

      const calloutType = textToSpecialCalloutType[typeString];

      if (calloutType) {
        return { calloutType, text };
      }
    }

    return {
      calloutType: null,
      text,
    };
  }
  public getIcon(): SupportedEmoji | undefined {
    const iconMap: Record<SpecialCalloutType, SupportedEmoji> = {
      [SpecialCalloutType.Note]: 'ℹ️',
      [SpecialCalloutType.Tip]: '💡',
      [SpecialCalloutType.Important]: '⚠️',
      [SpecialCalloutType.Warning]: '⚠️',
      [SpecialCalloutType.Caution]: '⚠️',
    };

    if (this.calloutType && iconMap[this.calloutType]) {
      return iconMap[this.calloutType];
    }

    return this.icon;
  }

  public toContentString(): string {
    const content =
      typeof this.text === 'string'
        ? this.text
        : this.text.map((el) => el.toContentString()).join('');
    return `[!${this.calloutType}](${content})`;
  }
}

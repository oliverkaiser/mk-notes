import { Element } from './Element.class';
import { RichTextElement } from './TextElement.class';
import { ElementType } from './types';

export type TableCellContent = string | RichTextElement;

export class TableElement extends Element {
  public rows: TableCellContent[][];

  constructor({ id, rows }: { id?: string; rows: TableCellContent[][] }) {
    super({ id, type: ElementType.Table });

    this.rows = rows;
  }

  public toContentString(): string {
    return this.rows
      .map((row) =>
        row
          .map((cell) => {
            if (typeof cell === 'string') {
              return cell;
            }
            // RichTextElement is an array
            return cell.map((element) => element.toContentString()).join('');
          })
          .join(' | ')
      )
      .join('\n');
  }
}

import { DefaultNamingStrategy } from 'typeorm';

/** Maps camelCase entity properties to the snake_case PostgreSQL columns. */
export class SnakeNamingStrategy extends DefaultNamingStrategy {
  override columnName(propertyName: string, customName: string | undefined, prefixes: string[]) {
    const name =
      customName ?? propertyName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

    return prefixes.length ? `${prefixes.join('_')}_${name}` : name;
  }
}

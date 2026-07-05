export declare function configRead(key: string): any;
export declare function configWrite(key: string, value: unknown): void;
export declare function configAddChangeListener(
  key: string,
  callback: (evt: CustomEvent<{ key: string; newValue: unknown }>) => void
): void;

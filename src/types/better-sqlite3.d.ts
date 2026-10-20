declare module 'better-sqlite3' {
  export interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export interface Statement<Row = unknown> {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): Row | undefined;
    all(...params: unknown[]): Row[];
  }

  export interface Database {
    prepare<Row = unknown>(sql: string): Statement<Row>;
    exec(sql: string): this;
    pragma(source: string): unknown;
    close(): this;
    readonly open: boolean;
    readonly inTransaction: boolean;
  }

  export interface DatabaseOptions {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
  }

  const Database: {
    new (filename: string, options?: DatabaseOptions): Database;
    (filename: string, options?: DatabaseOptions): Database;
  };

  export default Database;
}

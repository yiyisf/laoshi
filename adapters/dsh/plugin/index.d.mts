export declare const name: string;
export declare const inject: string[];
export declare function apply(
  ctx: unknown,
  config?: {
    home?: string;
    approvals?: "ask" | "allow";
    subagentProvider?: string;
    kitRoot?: string;
    board?: boolean;
    boardPort?: number;
    boardReadOnly?: boolean;
  },
): void;

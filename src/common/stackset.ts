/**
 * A StackSet helper class.
 * Converted from graphology source.
 */
export class StackSet {
    set: Set<string> = new Set<string>();
    stack: string[] = [];

    has(value: string): boolean {
        return this.set.has(value);
    }

    push(value: string): void {
        this.stack.push(value);
        this.set.add(value);
    }

    pop(): void {
        this.set.delete(this.stack.pop() as string);
    }

    path(value: string): string[] {
        return this.stack.concat(value);
    }

    static of(value: string, cycle: boolean): StackSet{
        const set = new StackSet();

        if (!cycle) {
            // Normally we add source both to set & stack
            set.push(value);
        } else {
            // But in case of cycle, we only add to stack so that we may reach the
            // source again (as it was not already visited)
            set.stack.push(value);
        }

        return set;
    }
}

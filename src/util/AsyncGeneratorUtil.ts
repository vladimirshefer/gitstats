export class AsyncGeneratorUtil {
    static async* flatMap<T, R>(items: T[], mapper: (item: T) => AsyncGenerator<R>): AsyncGenerator<R> {
        for (const item of items) {
            yield* mapper(item);
        }
    }

    static async* map<T, R>(source: AsyncIterable<T>, mapper: (item: T) => R): AsyncGenerator<R> {
        for await (const item of source) {
            yield mapper(item);
        }
    }

    static async* distinctCount<T>(source: AsyncIterable<T>): AsyncGenerator<[T, number]> {
        const result: { [key: string]: number } = {}
        for await (const item of source) {
            let k = JSON.stringify(item);
            result[k] = (result[k] || 0) + 1;
        }
        for (const [key, count] of Object.entries(result)) {
            const values = JSON.parse(key);
            yield [values, count];
        }
    }

}

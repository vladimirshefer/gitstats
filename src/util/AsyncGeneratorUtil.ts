export class AsyncGeneratorUtil {
    static async * of<T>(items: T[]): AsyncGenerator<T> {
        for (const item of items) {
            yield item;
        }
    }

    static async* flatMap<T, R>(items: AsyncGenerator<T>, mapper: (item: T) => AsyncGenerator<R>): AsyncGenerator<R> {
        for await (const item of items) {
            yield* mapper(item);
        }
    }

    static async * union<T>(sources: AsyncIterable<T>[]): AsyncGenerator<T> {
        for (const source of sources) {
            yield* source;
        }
    }

    static async* map<T, R>(source: AsyncIterable<T>, mapper: (item: T) => R): AsyncGenerator<R> {
        for await (const item of source) {
            yield mapper(item);
        }
    }

    static async* peek<T>(source: AsyncIterable<T>, consumer: (item: T) => void): AsyncGenerator<T> {
        for await (const item of source) {
            consumer(item);
            yield item;
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

export interface AsyncIteratorWrapper<T> {
    get(): AsyncGenerator<T>

    map<R>(mapper: (item: T) => R): AsyncIteratorWrapper<R>

    flatMap<R>(mapper: (item: T) => AsyncGenerator<R>): AsyncIteratorWrapper<R>

    forEach(consumer: (item: T) => void | Promise<void>): Promise<void>
}

export class AsyncIteratorWrapperImpl<T> implements AsyncIteratorWrapper<T> {
    private readonly source: AsyncGenerator<T>

    constructor(source: AsyncGenerator<T>) {
        this.source = source;
    }

    get(): AsyncGenerator<T> {
        return this.source;
    }

    map<R>(mapper: (item: T) => R): AsyncIteratorWrapper<R> {
        return new AsyncIteratorWrapperImpl<R>((async function* <T, R>(source: AsyncIterable<T>, mapper: (item: T) => R): AsyncGenerator<R> {
            for await (const item of source) {
                yield mapper(item);
            }
        })(this.source, mapper))
    }

    flatMap<R>(mapper: (item: T) => AsyncGenerator<R>): AsyncIteratorWrapper<R> {
        return new AsyncIteratorWrapperImpl(AsyncGeneratorUtil.flatMap(this.source, mapper))
    }

    async forEach(consumer: (item: T) => void | Promise<void>): Promise<void> {
        for await (const item of this.source) {
            await consumer(item);
        }
    }
}

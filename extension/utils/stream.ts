export async function* mapStream<T, U>(
  source: AsyncIterable<T>,
  fn: (item: T) => U,
): AsyncGenerator<U, void, undefined> {
  for await (const item of source) {
    yield fn(item);
  }
}

export async function collectStream(
  stream: AsyncGenerator<string, void, undefined>,
): Promise<string> {
  let result = '';
  for await (const token of stream) {
    result += token;
  }
  return result;
}

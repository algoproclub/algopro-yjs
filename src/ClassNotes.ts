// Reserve the prefix even for malformed names, before legacy file access checks.
export const isClassNotesDocument = (documentName: string) =>
  documentName.startsWith('class-notes');

export const parseClassNotesDocument = (documentName: string) => {
  const parts = documentName.split(':');
  if (parts.length !== 4 || parts[0] !== 'class-notes') {
    throw new Error('Invalid class notes document name');
  }

  const creationTime = Number(parts[3]);
  if (
    !Number.isSafeInteger(creationTime) ||
    creationTime < 0 ||
    String(creationTime) !== parts[3]
  ) {
    throw new Error('Invalid class notes creation time');
  }

  const ids = parts.slice(1, 3).map(encoded => {
    const id = decodeURIComponent(encoded);
    if (
      !id ||
      id.includes('/') ||
      id === '.' ||
      id === '..' ||
      /^__.*__$/.test(id) ||
      Buffer.byteLength(id, 'utf8') > 1500 ||
      encodeURIComponent(id) !== encoded
    ) {
      throw new Error('Invalid class notes document ID');
    }
    return id;
  });

  return { groupID: ids[0], classID: ids[1], creationTime };
};

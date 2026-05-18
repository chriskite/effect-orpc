it('exports createSWRUtils', async () => {
  expect(Object.keys(await import('./index'))).toContain('createSWRUtils')
})

it('exports something', async () => {
  expect(await import('./index')).toHaveProperty('createTanstackQueryUtils')
})

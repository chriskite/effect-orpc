it('exports something', async () => {
  expect(Object.keys(await import('./index')).length).toBeGreaterThanOrEqual(1)
})

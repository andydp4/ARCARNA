import app from '../../src/index'
import request from 'supertest'

describe('Order flow via engine', () => {
  it('creates order through engine and returns orderId', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({ customerId:'C1', lines:[{productId:'P1', quantity:1, unitPrice:35}], paymentMethod:'card' })
    expect(res.status).toBe(201)
    expect(res.body.orderId).toBeTruthy()
  })
})
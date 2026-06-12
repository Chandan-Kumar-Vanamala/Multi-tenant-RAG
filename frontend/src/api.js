import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || ''

// Axios instance — all REST calls use this
const api = axios.create({ baseURL: BASE_URL })

export default api

// Base URL string — for raw fetch calls (e.g. streaming)
export { BASE_URL }

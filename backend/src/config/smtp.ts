import nodemailer from 'nodemailer';
import { env } from './env.js';

export const smtpTransporter = nodemailer.createTransport({
  host: env.ETHEREAL_HOST,
  port: env.ETHEREAL_PORT,
  secure: env.ETHEREAL_SECURE,
  auth: {
    user: env.ETHEREAL_USER,
    pass: env.ETHEREAL_PASSWORD,
  },
});

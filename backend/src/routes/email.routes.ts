import { Router } from 'express';
import {
  listScheduledEmailsController,
  listSentEmailsController,
} from '../controllers/email.controller.js';

export const emailRouter = Router();
emailRouter.get('/emails/scheduled', listScheduledEmailsController);
emailRouter.get('/emails/sent', listSentEmailsController);

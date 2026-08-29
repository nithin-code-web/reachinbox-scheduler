import { Router } from 'express';
import {
  currentUserController,
  googleCallbackController,
  logoutController,
  startGoogleAuthController,
} from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const authRouter = Router();
authRouter.get('/auth/google', startGoogleAuthController);
authRouter.get('/auth/google/callback', googleCallbackController);
authRouter.post('/auth/logout', logoutController);
authRouter.get('/auth/me', requireAuth, currentUserController);

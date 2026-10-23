import {
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common"
import { Reflector } from "@nestjs/core"
import type { CanActivate, ExecutionContext } from "@nestjs/common"
import type { Request } from "express"

import type { AuthSession, GetSession } from "./session.js"

export const AUTH_SESSION_READER = Symbol("AUTH_SESSION_READER")
const IS_PUBLIC = Symbol("IS_PUBLIC")
const AUTH_SESSION = Symbol("AUTH_SESSION")
type AuthenticatedRequest = Request & { [AUTH_SESSION]?: AuthSession }

export const Public = () => SetMetadata(IS_PUBLIC, true)

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    return request[AUTH_SESSION]?.user
  }
)

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_SESSION_READER) private readonly getSession: GetSession
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ])

    if (isPublic) return true

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const headers = new Headers()

    for (const [name, value] of Object.entries(request.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(name, item)
      } else if (value !== undefined) {
        headers.set(name, value)
      }
    }

    const session = await this.getSession(headers)

    if (!session) throw new UnauthorizedException("Authentication required")
    if (!session.user.emailVerified) {
      throw new ForbiddenException("Email verification required")
    }

    request[AUTH_SESSION] = session
    return true
  }
}

export type AppUser = 'hubert' | 'grzesiek'

export function getAppUser(): AppUser {
  return process.env.APP_USER?.toLowerCase() === 'hubert' ? 'hubert' : 'grzesiek'
}

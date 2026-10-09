const ROUTES = {
  HOME: "/",
  SIGN_IN: "/sign-in",
  SIGN_UP: "/sign-up",
  DASHBOARD: "/dashboard",
  PROFILE: (id: string) => `/profile/${id}`,
};

export default ROUTES;
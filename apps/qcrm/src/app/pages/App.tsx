import { Crm } from "../Crm.tsx";
import { Nav } from "../Nav.tsx";

// The CRM itself. The shell is server-rendered; everything inside talks to /api from the browser.
export function App() {
  return (
    <>
      <Nav inner />
      <Crm />
    </>
  );
}

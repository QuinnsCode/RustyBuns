import { Crm } from "../Crm.tsx";
import { Nav } from "../Nav.tsx";

// The CRM itself. The shell is server-rendered; everything inside talks to /api from the browser.
export function App() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: `if(location.search.includes("demo=1"))document.documentElement.setAttribute("data-framed","")` }} />
      <Nav inner />
      <Crm />
    </>
  );
}

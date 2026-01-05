# table-talk
Table Talk — core codebase for all versions, maintained by Made to Connect Co.
All versions of the product — past, present, and future — will be developed and stored here.

---

## 📌 Purpose of This Repository

- Serve as the permanent home for all Table Talk application code  
- Support continuous evolution across multiple versions  
- Maintain a clean structure for collaboration, development, and deployment  
- Keep the codebase organized and easy to extend over time  

This repository does **not** define product specifications, features, or architecture decisions.  
Those may change over time and are documented separately.

---

## 🧱 High-Level Structure

The repository follows a simple, scalable layout that supports long-term growth.  
Typical top-level structure may include:

/src              -> Core application source code
/tests            -> Automated tests (unit, integration, later e2e)
/docs             -> Internal product docs, diagrams, version notes
/scripts          -> Database migrations, utilities, automation
/config           -> Configuration templates, schema files
.env.example      -> Environment variable template (no secrets)
package.json      -> Project metadata & dependencies
README.md         -> Project overview and structure


The /src directory contains the main application code.
While the internal organization may evolve over time, the project currently follows a modular structure that keeps controllers, services, routes, middleware, and other components clearly separated.

/src
  /app
    /controllers
    /services
    /routes
    /middleware
    /models
    /utils
  index.js         -> Entry point

  
Each area of the codebase is free to evolve as the product evolves.

---

## 🔀 Branching Model

A lightweight branching approach keeps development organized:

- **main** → stable, production-ready code  
- **dev** → active development  
- **feature/<name>** → individual feature updates  

Teams may adapt this model as the system grows.

---

## 🧪 Testing & Quality

General expectations:

- Code should be readable, maintainable, and well-organized  
- Tests should accompany meaningful changes  
- Breaking changes should be versioned or tagged clearly  

There is no fixed testing framework required — this may evolve with the product.

---

## 📦 Versioning

Table Talk versions are tracked through:

- Git tags (e.g., `v1.0`, `v2.3`, `v12.4.1`)
- Release notes (optional)
- Documentation stored separately in `/docs` or internal systems

The repository itself is intentionally **not tied to any specific version**.

---

## 🔒 Ownership

All work in this repository is full work-for-hire.  
All intellectual property belongs exclusively to **Made to Connect Co.**

External contributors receive temporary access as needed.

---

## 📄 License

This is a private, proprietary repository.  
No open-source license is applied.

---

## 📞 Maintainer

**Made to Connect Co.**  
Owner: Charles Peterson


const express = require("express");
const body_parser = require("body-parser");
const axios = require("axios");
const {
  createIssue,
  getIssuesByPhoneNumber,
  deleteIssue,
  checkIfTrackerExists,
  getProjectsByPhoneNumber,
  createProject,
  deleteIssuesByPhoneNumber,
  getProjectById,
  deleteProject,
  getAllPriorites,
  getUserProjectsByToken,
  getUserTokenByPhoneNumber,
  createIssueFromUser,
  getIssuesByToken,
} = require("./redmine");

require("dotenv").config();

const app = express().use(body_parser.json());

let token = process.env.TOKEN; // API token
const mytoken = process.env.MYTOKEN; // personal token

// UTILITIES
const emojies = {
  new: "🆕",
  "in progress": "⌛",
  resolved: "✅",
  closed: "⛔", // closed and rejected issues will be deleted automatically
};

const doubleHorizontalLine = String.fromCharCode(0x2e3a);

// User session data
const userSessions = {};

app.listen(process.env.PORT || 3000, () => {
  console.log("webhook is listening");
});

// to verify the callback url from dashboard side - cloud api side
app.get("/webhook", (req, res) => {
  let mode = req.query["hub.mode"];
  let challenge = req.query["hub.challenge"];
  let token = req.query["hub.verify_token"];
  if (mode && token) {
    if (mode === "subscribe" && token === mytoken) {
      res.status(200).send(challenge);
    } else {
      res.status(403);
    }
  }
});

app.post("/webhook", async (req, res) => {
    console.log('ddd')
    let body_param = req.body;
  if (body_param.object) {
    if (
      body_param.entry &&
      body_param.entry[0].changes &&
      body_param.entry[0].changes[0].value.messages &&
      body_param.entry[0].changes[0].value.messages[0]
    ) {
      // get all data from request ...
      let phon_no_id =
        body_param.entry[0].changes[0].value.metadata.phone_number_id;
      let from = body_param.entry[0].changes[0].value.messages[0].from;
      let msg_body = body_param.entry[0].changes[0].value.messages[0].text.body;
      let user_name =
        body_param.entry[0].changes[0].value.contacts[0].profile.name;
      console.log(
        "From:",
        from,
        "\nMessage:",
        msg_body,
        "\nUsername:",
        user_name
      );

      // Initialize user session if not present
      if (!userSessions[from]) {
        userSessions[from] = {
          state: "idle",
          issueSubject: "",
          issueDescription: "",
          issuePriority: "",
        };
      }
      // get redmine tokens
      admin_token = process.env.ADMIN_TOKEN;
      user_token = await getUserTokenByPhoneNumber(from);
      
        // if (!user_token) {
        // await sendMessage(
        //         from,
        //         phon_no_id,
        //         "⚠️ Votre numéro de téléphone n'est pas enregistré. Veuillez l'ajouter à votre compte Redmine."
        //     );

        // }
        
      // Process user input based on current state
      switch (userSessions[from].state) {
        case "idle":
          if (
            msg_body.toLowerCase() === "créer" ||
            msg_body.toLowerCase() === "creer"
          ) {
            userSessions[from].state = "awaiting_project_selection";
              try {
              const projects = await getUserProjectsByToken(user_token);
              if (projects.length === 0) {
                await sendMessage(
                  from,
                  phon_no_id,
                  "Aucun projet trouvé pour ce numéro de téléphone."
                );
                userSessions[from].state = "idle";
              } else {
                let projectList = projects
                  .map((project) => `ID: ${project.id}, Nom: ${project.name}`)
                  .join("\n");
                let message = `Veuillez sélectionner l'ID du projet dans la liste suivante pour soumettre le ticket :\n\n${projectList}`;
                await sendMessage(from, phon_no_id, message);
              }
            } catch (error) {
              console.error(
                "Erreur lors de la récupération des projets:",
                error
              );
              await sendMessage(
                from,
                phon_no_id,
                "⚠️ Une erreur est survenue lors de la récupération de vos projets. Veuillez réessayer plus tard."
              );
            }
          } else if (msg_body.toLowerCase() === "aide") {
            await sendMessage(
              from,
              phon_no_id,
              "Utilisez les commandes suivantes:\n\n" +
                doubleHorizontalLine +
                "\n\n'créer' pour commencer à créer un ticket,\n\n'tout' pour lister tous les tickets avec leurs ID,\n\n'supprimer [ID]' pour supprimer un ticket,\n\n'supprimer tout' pour supprimer tous les tickets,\n\n'supprimer projet [ID]' pour supprimer un projet,\n\n'projet' pour obtenir les détails du projet,\n\n'état' pour vérifier l'état de tous les tickets,\n\n'annuler' pour annuler le processus de création du ticket.\n\n" +
                doubleHorizontalLine +
                "\n\n Pour plus d'aide, contactez notre support."
            );
          } else if (msg_body.toLowerCase() === "tout") {
            try {
              const response = await getIssuesByToken(user_token, from);
              let issues = response;
              if (issues.length === 0) {
                await sendMessage(
                  from,
                  phon_no_id,
                  "Aucun ticket trouvé pour ce numéro de téléphone."
                );
              } else {
                let message =
                  "Tous les tickets de " +
                  user_name +
                  ":\n\n" +
                  doubleHorizontalLine.repeat(3) +
                  "\n";
                issues.forEach((issue) => {
                  message += `ID: ${issue.id}, Sujet: ${issue.subject} ${
                    emojies[issue.status.name.toLowerCase()]
                  }\n ${doubleHorizontalLine.repeat(3)}\n`;
                });
                message +=
                  "\n\nPour supprimer un ticket, tapez 'supprimer' suivi de l'ID du ticket. exemple 'supprimer 1'";
                await sendMessage(from, phon_no_id, message);
              }
            } catch (error) {
              console.error(
                "Erreur lors de la récupération des tickets ou de l'envoi du message:",
                error
              );
              await sendMessage(
                from,
                phon_no_id,
                "⚠️ Une erreur est survenue lors du traitement de votre demande. Veuillez réessayer plus tard."
              );
            }
          } else if (msg_body.toLowerCase().startsWith("supprimer")) {
            if (msg_body.split(" ")[1] === "projet") {
              let project_id = msg_body.split(" ")[2];
              try {
                let response = await deleteProject(project_id);
                await sendMessage(
                  from,
                  phon_no_id,
                  `✅ Projet avec l'ID ${project_id} supprimé avec succès.`
                );
              } catch (error) {
                if (error.message === "Projet non trouvé") {
                  await sendMessage(
                    from,
                    phon_no_id,
                    "⚠️ Aucun projet trouvé avec l'ID: " + project_id
                  );
                } else {
                  console.error(
                    "Erreur lors de la suppression du projet:",
                    error
                  );
                  await sendMessage(
                    from,
                    phon_no_id,
                    "⚠️ Une erreur est survenue lors de la suppression du projet. Veuillez réessayer plus tard."
                  );
                }
              }
            } else if (msg_body.split(" ")[1] == "tout") {
              try {
                await deleteIssuesByPhoneNumber(from);
                await sendMessage(
                  from,
                  phon_no_id,
                  "✅ Tous les tickets supprimés avec succès."
                );
              } catch (error) {
                console.error(
                  "Erreur lors de la suppression des tickets:",
                  error
                );
                await sendMessage(
                  from,
                  phon_no_id,
                  "⚠️ Une erreur est survenue lors de la suppression de tous les tickets. Veuillez réessayer plus tard."
                );
              }
            } else {
              const issueIds = msg_body.split(" ").slice(1);
              issueIds.forEach(async (issueId) => {
                try {
                  await deleteIssue(issueId);
                  await sendMessage(
                    from,
                    phon_no_id,
                    "✅ Ticket " + issueId + " supprimé avec succès."
                  );
                } catch (error) {
                  await sendMessage(
                    from,
                    phon_no_id,
                    "⚠️ Ticket avec l'ID " + issueId + " non trouvé."
                  );
                }
              });
            }
          } else if (msg_body.toLowerCase() === "projet") {
            try {
              const projects = await getUserProjectsByToken(user_token);
              if (projects.length === 0) {
                await sendMessage(
                  from,
                  phon_no_id,
                  "Aucun projet trouvé pour ce numéro de téléphone."
                );
              } else {
                let message = `Vos projets:\n\n`;
                projects.forEach((project) => {
                  message += `ID: ${project.id}, Nom: ${project.name}\n`;
                });
                await sendMessage(from, phon_no_id, message);
              }
            } catch (error) {
              console.error(
                "Erreur lors de la récupération des projets:",
                error
              );
              await sendMessage(
                from,
                phon_no_id,
                "⚠️ Une erreur est survenue lors de la récupération de vos projets. Veuillez réessayer plus tard."
              );
            }
          } else if (msg_body.toLowerCase() === "etat") {
            try {
              const response = await getIssuesByToken(user_token, from);
              let issues = response;
              if (issues.length === 0) {
                await sendMessage(
                  from,
                  phon_no_id,
                  "Aucun ticket trouvé pour ce numéro de téléphone."
                );
              } else {
                let message = "États de vos tickets:\n\n";
                issues.forEach((issue) => {
                  message += `ID: ${issue.id}, Sujet: ${
                    issue.subject
                  }, Statut: ${issue.status.name} ${
                    emojies[issue.status.name.toLowerCase()]
                  }\n`;
                });
                await sendMessage(from, phon_no_id, message);
              }
            } catch (error) {
              console.error(
                "Erreur lors de la récupération des états des tickets:",
                error
              );
              await sendMessage(
                from,
                phon_no_id,
                "⚠️ Une erreur est survenue lors de la récupération de l'état de vos tickets. Veuillez réessayer plus tard."
              );
            }
          } else {
            await sendMessage(
              from,
              phon_no_id,
              "Commande non reconnue. Tapez 'aide' pour obtenir la liste des commandes disponibles."
            );
          }
          break;

        case "awaiting_project_selection":
          if (msg_body.toLowerCase() === "annuler") {
            userSessions[from] = {
              state: "idle",
              issueSubject: "",
              issueDescription: "",
              issuePriority: "",
              selectedProjectId: "",
            };
            await sendMessage(
              from,
              phon_no_id,
              "Processus de création de ticket annulé."
            );
            break;
          }
          userSessions[from].selectedProjectId = msg_body;
          validProjects = await getUserProjectsByToken(user_token);
          if (validProjects.some((p) => p.id == msg_body)) {
            userSessions[from].state = "awaiting_subject";
            await sendMessage(from, phon_no_id, "Entrez le sujet du ticket.");
          } else {
            await sendMessage(
              from,
              phon_no_id,
              "⚠️ Projet invalide. Veuillez sélectionner un ID de projet valide."
            );
            userSessions[from].state = "awaiting_project_selection";
          }

          break;

        case "awaiting_subject":
          if (msg_body.toLowerCase() === "annuler") {
            userSessions[from] = {
              state: "idle",
              issueSubject: "",
              issueDescription: "",
              issuePriority: "",
              selectedProjectId: "",
            };
            await sendMessage(
              from,
              phon_no_id,
              "Processus de création de ticket annulé."
            );
            break;
          }
          userSessions[from].issueSubject = msg_body;
          userSessions[from].state = "awaiting_description";
          await sendMessage(
            from,
            phon_no_id,
            "Veuillez entrer la description du ticket."
          );
          break;

        case "awaiting_description":
          if (msg_body.toLowerCase() === "annuler") {
            userSessions[from] = {
              state: "idle",
              issueSubject: "",
              issueDescription: "",
              issuePriority: "",
              selectedProjectId: "",
            };
            await sendMessage(
              from,
              phon_no_id,
              "Processus de création de ticket annulé."
            );
            break;
          }
          userSessions[from].issueDescription = msg_body;
          userSessions[from].state = "awaiting_priority";
          let message =
            "Veuillez envoyer l'ID de priorité correspondant au ticket:\n";
          try {
            const response = await getAllPriorites();
            response.issue_priorities.forEach((priority) => {
              message += `ID : ${priority.id} | Priorité : ${priority.name}\n`;
            });
            await sendMessage(from, phon_no_id, message);
          } catch (error) {
            console.error(
              "Erreur lors de la récupération des priorités :",
              error
            );
            await sendMessage(
              from,
              phon_no_id,
              "⚠️ Une erreur s'est produite lors de la récupération des priorités. Veuillez réessayer plus tard."
            );
          }

          break;
        case "awaiting_priority":
          if (msg_body.toLowerCase() === "annuler") {
            userSessions[from] = {
              state: "idle",
              issueSubject: "",
              issueDescription: "",
              issuePriority: "",
              selectedProjectId: "",
            };
            await sendMessage(
              from,
              phon_no_id,
              "Processus de création de ticket annulé."
            );
            break;
          }
          userSessions[from].issuePriority = msg_body;
          let priorities = await getAllPriorites();
          let test = priorities.issue_priorities.some((p) => p.id == msg_body);
          if (test) {
            priority_name = priorities.issue_priorities.find(
              (p) => p.id == msg_body
            ).name; // get priority name to show to the user
            userSessions[from].state = "confirm_creation";
            await sendMessage(
              from,
              phon_no_id,
              `Voulez-vous confirmer la création du ticket avec les détails suivants?\n\nSujet: ${userSessions[from].issueSubject}\nDescription: ${userSessions[from].issueDescription}\nPriorité: ${priority_name}\n\nEnvoyez 'oui' pour confirmer ou 'non' pour annuler.`
            );
          } else {
            await sendMessage(
              from,
              phon_no_id,
              "⚠️ Priorité invalide. Veuillez envoyer l'ID de priorité valide."
            );
            userSessions[from].state = "awaiting_priority";
          }
          break;

        case "confirm_creation":
          if (msg_body.toLowerCase() === "annuler") {
            userSessions[from] = {
              state: "idle",
              issueSubject: "",
              issueDescription: "",
              issuePriority: "",
              selectedProjectId: "",
            };
            await sendMessage(
              from,
              phon_no_id,
              "Processus de création de ticket annulé."
            );
            break;
          }
          if (msg_body.toLowerCase() === "oui") {
            const issueDesc =
              userSessions[from].issueDescription +
              "\n\n" +
              doubleHorizontalLine +
              "\nNuméro de téléphone : " +
              from +
              "\nÉmis par : " +
              user_name;

            const issue = {
              issue: {
                project_id: userSessions[from].selectedProjectId,
                tracker_id: process.env.TRACKER_ID,
                subject: userSessions[from].issueSubject,
                description: issueDesc,
                priority_id: userSessions[from].issuePriority,
              },
            };

            try {
              const issueResponse = await createIssueFromUser(
                user_token,
                issue
              );
              await sendMessage(
                from,
                phon_no_id,
                `✅ Ticket créé avec succès avec l'ID : ${issueResponse.issue.id}`
              );
            } catch (error) {
              console.error("Erreur lors de la création du ticket :", error);
              await sendMessage(
                from,
                phon_no_id,
                "⚠️ Une erreur s'est produite lors de la création de votre ticket. Veuillez réessayer plus tard."
              );
            } finally {
              userSessions[from] = {
                state: "idle",
                issueSubject: "",
                issueDescription: "",
                issuePriority: "",
                selectedProjectId: "",
              };
            }
          } else if (msg_body.toLowerCase() === "non") {
            await sendMessage(
              from,
              phon_no_id,
              "Le processus de création du ticket a été annulé."
            );
            userSessions[from] = {
              state: "idle",
              issueSubject: "",
              issueDescription: "",
              issuePriority: "",
              selectedProjectId: "",
            };
          } else {
            await sendMessage(
              from,
              phon_no_id,
              "⚠️ Commande invalide. Envoyez 'non' pour annuler ou 'oui' pour confirmer."
            );
          }
          break;

        default:
          await sendMessage(
            from,
            phon_no_id,
            "Commande non reconnue. Tapez 'aide' pour obtenir la liste des commandes disponibles."
          );
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

async function sendMessage(from, phon_no_id, message) {
  await axios({
    method: "POST",
    url:
      "https://graph.facebook.com/v16.0/" +
      phon_no_id +
      "/messages?access_token=" +
      token,
    data: {
      messaging_product: "whatsapp",
      to: from,
      text: {
        body: message,
      },
    },
    headers: { "Content-Type": "application/json" },
  });
}

# The git container behind codeSplitter's ssh gate (#5500, #5505): sshd on 2222, one `git` user whose every login runs
# git-serve.sh, which bridges the one repo it asks for to codeSplitter's smart-HTTP remote. It keeps no repos, and no
# keys: sshd asks whose each offered key is (authorized-keys.sh, #5504).
FROM alpine:3.20
RUN apk add --no-cache openssh-server git curl \
 && adduser -D -s /bin/sh git && passwd -u git \
 && ssh-keygen -A \
 && mkdir -p /home/git/.ssh && chown -R git:git /home/git
COPY entry.sh git-serve.sh authorized-keys.sh /
# sshd runs an AuthorizedKeysCommand only if root owns it and nobody else can write it.
RUN chown root:root /authorized-keys.sh \
 && chmod 755 /entry.sh /git-serve.sh /authorized-keys.sh
EXPOSE 2222
CMD ["sh", "/entry.sh"]

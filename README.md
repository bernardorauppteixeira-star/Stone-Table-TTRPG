# Stone League RPG

Mesa virtual para TTRPG. Inicie o servidor com `node server.js` e acesse `http://localhost:3000` para criar uma conta ou entrar com nome de usuário e senha.

As senhas são armazenadas como hashes scrypt e as sessões usam cookies HttpOnly. As contas ficam em `.stone-table-data/`, ignorada pelo Git. Para disponibilizar o app fora da máquina local, configure HTTPS e um proxy reverso; contas e sessões deste protótipo não sincronizam os dados do jogo, que continuam armazenados localmente no navegador. Projéteis em voo também são salvos no navegador e restaurados após sair e entrar novamente; o movimento continua no próximo turno.

Na área **Configurações**, importe MP3s para a biblioteca local e ajuste a reprodução, afinação, velocidade, loop, reverberação e eco. Ao tocar uma faixa em uma sala, o áudio é enviado aos jogadores conectados e reproduzido nos navegadores deles; cada navegador precisa permitir áudio após uma interação inicial. Os arquivos ficam armazenados localmente no navegador do mestre. Use **Abrir tela dos jogadores** na seção de personagens para abrir `players.html` em outra janela. Mova essa janela para a segunda tela e projete-a manualmente. Os jogadores podem alternar entre o mapa e a tela de personagens; nenhum controle do mestre aparece nessa janela.

Personagens, mapa e iniciativa usam um estado único. Personagens e tokens recém-criados começam com vitalidade e lucidez nos respectivos máximos. Vincule um personagem pelo campo **Token do mapa**; projéteis com dano configurado reduzem a vitalidade do personagem atingido. Na ferramenta de projéteis, além do disparo linear, escolha cone ou explosão: os dois partem do token ativo na iniciativa, cones permitem ajustar o ângulo e explosões usam o raio configurado. O estado antigo é migrado automaticamente ao abrir o Stone League RPG.

Na área **Personagens e combate**, salve fichas completas na biblioteca local do navegador e carregue-as em outro personagem; atributos, imagem e golpes configurados acompanham a ficha, sem trocar o vínculo do token. Cada atributo pode ser testado com uma rolagem de d20 somada ao seu valor. Cadastre golpes físicos, especiais, brutos, verdadeiros ou de alma com expressões de dano, como `2d6+1`. Para golpes brutos, verdadeiros e de alma, escolha se a força adicional será Física ou Especial. Na **Calculadora de estatísticas**, compare duas fichas para rolar um golpe contra o alvo e, se desejar, aplique o dano à vitalidade; dano de Alma também reduz a Lucidez.

## Cálculo de dano

O cálculo base começa com `dado × força / 10`, multiplica por `danoMult`, aplica `reducaoA`, subtrai `defesa × defesaMult / 2` e `defesaP × 1,5`, aplica `reducaoD`, divide por `divisao` e limita o resultado mínimo a zero. A força usada é `forca` mais Força Física ou Especial, conforme o tipo escolhido; o `forcaMult` não afeta o resultado final.

- **Bruto:** usa a menor Resistência Física/Especial do alvo como resistência adicional na fórmula e subtrai novamente 30% da Resistência Perfeita após o cálculo.
- **Verdadeiro:** garante no mínimo 50% do dano possível do atacante, calculado sem as defesas, resistências, reduções ou divisão do alvo.
- **Alma:** aplica 70% do dano calculado à Vitalidade e o mesmo valor à Lucidez.

Agilidade e Lucidez não são somadas às forças ou defesas no cálculo de dano.

## Rolagem de dados

Rolagens aleatórias de d4 a d20 usam a física 3D de `@3d-dice/dice-box`. d30, d60 e d100 usam poliedros convexos quase esféricos, com 30, 60 e 100 faces triangulares; o resultado sorteado é destacado na face voltada para a câmera. A animação assenta no resultado escolhido pelo gerador criptográfico do app. Os renderizadores carregam sob demanda e requerem conexão à internet e WebGL; sem eles, o app usa a animação local existente. Moedas continuam nesse fallback. Os resultados são enviados aos demais clientes.

Na rolagem, informe resultados externos no formato `1d4(3)+2d8(12)`: o valor entre parênteses é a soma exata do respectivo grupo, distribuída entre faces válidas. Os valores e o total são exibidos diretamente, sem animação 3D.